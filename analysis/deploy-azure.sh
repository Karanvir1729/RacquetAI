#!/usr/bin/env bash
# One-shot deploy of the RacquetIQ analysis server to Azure Container Instances.
# Prereq: `az login` done. Builds the image in Azure (az acr build — no local
# Docker), then runs it with a public DNS name on port 8082.
#
#   bash analysis/deploy-azure.sh            # deploy / update
#   bash analysis/deploy-azure.sh --status   # show state + URL
#   bash analysis/deploy-azure.sh --down     # delete the container (keep image)
set -euo pipefail

RG="racquetiq-rg"
LOC="${RACQUETIQ_AZ_LOCATION:-eastus}"
ACR="racquetiqacr"          # global namespace; suffixed with sub hash below
CONTAINER="racquetiq-analysis"
IMAGE_TAG="racquetiq-analysis:v1"
CPU=4
MEMORY=8

SUB_ID=$(az account show --query id -o tsv)
SUFFIX=$(printf "%s" "$SUB_ID" | shasum | cut -c1-6)
ACR="${ACR}${SUFFIX}"
DNS_LABEL="racquetiq-${SUFFIX}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FQDN="${DNS_LABEL}.${LOC}.azurecontainer.io"

# The public API hostname. A CNAME in the racketiq.tech zone (Azure DNS)
# points it at the ACI FQDN, and Caddy serves BOTH names. Why two names, and
# why the storage account below: Let's Encrypt issues at most 5 certificates
# per exact hostname per 168h, and until Caddy's /data was persisted every
# redeploy recreated the sidecar with empty storage and burned one. On
# 2026-08-21 the fifth deploy of the week left the ACI FQDN with no
# certificate at all (HTTP 429 from LE, "retry after 23:12 UTC") and the
# HTTPS site could not reach a perfectly healthy server. The Azure Files
# share makes a recreate reuse the certificate instead of requesting one.
API_HOST="${RACQUETIQ_API_HOST:-api.racketiq.tech}"
TLS_SA="racquetiq${SUFFIX}"      # storage account (global namespace)
TLS_SHARE_DATA="caddy-data"      # -> /data   (certificates, ACME account)
TLS_SHARE_CONFIG="caddy-config"  # -> /config (Caddy autosave)

if [[ "${1:-}" == "--status" ]]; then
  az container show -g "$RG" -n "$CONTAINER" \
    --query "{state:instanceView.state, fqdn:ipAddress.fqdn, ip:ipAddress.ip}" -o table
  echo "URL: https://${API_HOST}  (also https://${FQDN}; plain http on :8082 kept for older app builds)"
  exit 0
fi

if [[ "${1:-}" == "--down" ]]; then
  az container delete -g "$RG" -n "$CONTAINER" --yes
  echo "Container deleted. Image kept in ACR; redeploy with: bash analysis/deploy-azure.sh"
  exit 0
fi

echo "==> Resource group $RG ($LOC)"
az group create -n "$RG" -l "$LOC" -o none

echo "==> Container registry $ACR"
az acr create -n "$ACR" -g "$RG" --sku Basic --admin-enabled true -o none 2>/dev/null || true

# Caddy comes from OUR registry: anonymous ACI pulls from Docker Hub get
# rate-limited ("RegistryErrorResponse"), which killed a deploy mid-recreate.
if ! az acr repository show -n "$ACR" --image caddy:2 -o none 2>/dev/null; then
  echo "==> Importing caddy:2 into $ACR"
  az acr import -n "$ACR" --source docker.io/library/caddy:2 --image caddy:2 -o none
fi

# RACQUETIQ_SKIP_BUILD=1 recreates the container group from the image already
# in ACR — for sidecar/YAML-only changes where a 3-minute rebuild of an
# unchanged image is pure wait.
BUILD_CTX=$(mktemp -d)
GROUP_YAML=""
trap 'rm -rf "$BUILD_CTX"; rm -f "$GROUP_YAML"' EXIT
if [[ "${RACQUETIQ_SKIP_BUILD:-}" == "1" ]]; then
  echo "==> Skipping image build (RACQUETIQ_SKIP_BUILD=1); using ${IMAGE_TAG} already in ${ACR}"
else
echo "==> Building image in Azure (a few minutes)"
# Stage only what the Dockerfile needs: az acr build uploads the whole
# context dir before .dockerignore applies, which used to mean hundreds of
# MB of local job artifacts — and the .env file — riding along.
# THE list of server modules that ship. The Dockerfile does `COPY *.py`, so
# a module missing here is a module missing from the image — and the failure
# is an ImportError at boot, long after every local test has passed.
cp "$SCRIPT_DIR/Dockerfile" "$SCRIPT_DIR/requirements.txt" \
   "$SCRIPT_DIR/analyze.py" "$SCRIPT_DIR/server.py" "$SCRIPT_DIR/platform_api.py" \
   "$SCRIPT_DIR/coach_api.py" \
   "$BUILD_CTX/"
cp -R "$SCRIPT_DIR/tools" "$BUILD_CTX/tools"
az acr build -r "$ACR" -t "$IMAGE_TAG" "$BUILD_CTX" -o none
fi

echo "==> Starting container group ($CPU vCPU / ${MEMORY}GB + TLS sidecar)"
ACR_USER=$(az acr credential show -n "$ACR" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR" --query 'passwords[0].value' -o tsv)

# Platform secrets (Stripe billing + admin metrics) ride along from
# analysis/.env when it exists; without it the /billing and /admin endpoints
# answer 503 and the analysis endpoints work exactly as before.
ENV_YAML=""
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Z_]+$ && -n "$value" ]] || continue
    ENV_YAML="${ENV_YAML}
        - name: ${key}
          secureValue: '${value}'"
  done < "$SCRIPT_DIR/.env"
fi

# Persistent storage for Caddy's certificates (see API_HOST above). Soft-fail:
# a deploy must never be blocked by the storage account, but without it every
# recreate asks Let's Encrypt for a new certificate and five of those in a
# week takes the HTTPS API down.
echo "==> TLS certificate storage ($TLS_SA: $TLS_SHARE_DATA, $TLS_SHARE_CONFIG)"
az provider register --namespace Microsoft.Storage --wait -o none 2>/dev/null || true
az storage account show -n "$TLS_SA" -g "$RG" -o none 2>/dev/null \
  || az storage account create -n "$TLS_SA" -g "$RG" -l "$LOC" --sku Standard_LRS \
       --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false -o none \
  || echo "    (could not create $TLS_SA)"
TLS_KEY=$(az storage account keys list -n "$TLS_SA" -g "$RG" --query '[0].value' -o tsv 2>/dev/null || true)
TLS_VOLUMES=""
TLS_MOUNTS=""
if [[ -n "$TLS_KEY" ]]; then
  # Tolerant: on an existing share the CLI answers 409 and some local az
  # installs then crash parsing the XML error body (python expat). The share
  # is created once; if it is truly missing the container create below fails
  # loudly at the mount.
  for share in "$TLS_SHARE_DATA" "$TLS_SHARE_CONFIG"; do
    az storage share create -n "$share" --account-name "$TLS_SA" --account-key "$TLS_KEY" --quota 1 -o none 2>/dev/null \
      || echo "    ($share already exists, or could not be created)"
  done
  TLS_MOUNTS="
        volumeMounts:
          - { name: caddy-data, mountPath: /data }
          - { name: caddy-config, mountPath: /config }"
  TLS_VOLUMES="
  volumes:
    - name: caddy-data
      azureFile: { shareName: ${TLS_SHARE_DATA}, storageAccountName: ${TLS_SA}, storageAccountKey: '${TLS_KEY}' }
    - name: caddy-config
      azureFile: { shareName: ${TLS_SHARE_CONFIG}, storageAccountName: ${TLS_SA}, storageAccountKey: '${TLS_KEY}' }"
else
  echo "    WARNING: no storage key — certificates will NOT persist across redeploys (Let's Encrypt: 5/week/hostname)"
fi

# Caddy serves the API hostname and the raw ACI FQDN (older app builds and
# the Stripe webhook still use the latter). A Caddyfile rather than
# `caddy reverse-proxy`, because that flag takes exactly one --from.
CADDYFILE="${API_HOST}, ${FQDN} {\n\treverse_proxy localhost:8082\n}\n"

# Two containers, one group: the Flask server, and a Caddy sidecar that
# terminates TLS on 443 with an automatic Let's Encrypt certificate for both
# names. HTTPS matters because the live site is HTTPS and browsers refuse
# mixed-content calls to plain http. Port 8082 stays public so app builds
# that predate the https default keep working.
GROUP_YAML=$(mktemp)
cat > "$GROUP_YAML" <<EOF
apiVersion: '2021-10-01'
location: ${LOC}
name: ${CONTAINER}
properties:
  osType: Linux
  restartPolicy: Always
  imageRegistryCredentials:
    - server: ${ACR}.azurecr.io
      username: ${ACR_USER}
      password: '${ACR_PASS}'
  ipAddress:
    type: Public
    dnsNameLabel: ${DNS_LABEL}
    ports:
      - { protocol: TCP, port: 80 }
      - { protocol: TCP, port: 443 }
      - { protocol: TCP, port: 8082 }
  containers:
    - name: analysis
      properties:
        image: ${ACR}.azurecr.io/${IMAGE_TAG}
        ports:
          - { protocol: TCP, port: 8082 }
        resources:
          requests: { cpu: $((CPU - 1)), memoryInGB: $((MEMORY - 1)) }
        environmentVariables:${ENV_YAML}
    - name: tls
      properties:
        image: ${ACR}.azurecr.io/caddy:2
        command: ['sh', '-c', 'printf "%b" "\$CADDYFILE" > /etc/caddy/Caddyfile && exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile']
        environmentVariables:
          - { name: CADDYFILE, value: '${CADDYFILE}' }
        ports:
          - { protocol: TCP, port: 80 }
          - { protocol: TCP, port: 443 }
        resources:
          requests: { cpu: 1, memoryInGB: 1 }${TLS_MOUNTS}${TLS_VOLUMES}
EOF

# The group spec changes shape (single container -> sidecar pair), and ACI
# can't mutate a running group's containers — recreate it.
az container delete -g "$RG" -n "$CONTAINER" --yes -o none 2>/dev/null || true
az container create -g "$RG" --file "$GROUP_YAML" -o none

URL="https://${API_HOST}"
echo
echo "==> Deployed. Analysis server URL (paste into the app's Settings):"
echo "    $URL   (also https://${FQDN})"
echo "==> Health check (first hit can wait on the Let's Encrypt issuance):"
curl -s --max-time 60 "$URL/health" || echo "(container still starting — retry in ~1 min)"
echo
