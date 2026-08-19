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

if [[ "${1:-}" == "--status" ]]; then
  az container show -g "$RG" -n "$CONTAINER" \
    --query "{state:instanceView.state, fqdn:ipAddress.fqdn, ip:ipAddress.ip}" -o table
  echo "URL: https://${FQDN}  (plain http on :8082 kept for older app builds)"
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

echo "==> Building image in Azure (a few minutes)"
# Stage only what the Dockerfile needs: az acr build uploads the whole
# context dir before .dockerignore applies, which used to mean hundreds of
# MB of local job artifacts — and the .env file — riding along.
BUILD_CTX=$(mktemp -d)
GROUP_YAML=""
trap 'rm -rf "$BUILD_CTX"; rm -f "$GROUP_YAML"' EXIT
cp "$SCRIPT_DIR/Dockerfile" "$SCRIPT_DIR/requirements.txt" \
   "$SCRIPT_DIR/analyze.py" "$SCRIPT_DIR/server.py" "$SCRIPT_DIR/platform_api.py" \
   "$BUILD_CTX/"
cp -R "$SCRIPT_DIR/tools" "$BUILD_CTX/tools"
az acr build -r "$ACR" -t "$IMAGE_TAG" "$BUILD_CTX" -o none

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

# Two containers, one group: the Flask server, and a Caddy sidecar that
# terminates TLS on 443 with an automatic Let's Encrypt certificate for the
# group's own FQDN. HTTPS matters because the live site is HTTPS and browsers
# refuse mixed-content calls to plain http. Port 8082 stays public so app
# builds that predate the https default keep working.
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
        command: ['caddy', 'reverse-proxy', '--from', '${FQDN}', '--to', 'localhost:8082']
        ports:
          - { protocol: TCP, port: 80 }
          - { protocol: TCP, port: 443 }
        resources:
          requests: { cpu: 1, memoryInGB: 1 }
EOF

# The group spec changes shape (single container -> sidecar pair), and ACI
# can't mutate a running group's containers — recreate it.
az container delete -g "$RG" -n "$CONTAINER" --yes -o none 2>/dev/null || true
az container create -g "$RG" --file "$GROUP_YAML" -o none

URL="https://${FQDN}"
echo
echo "==> Deployed. Analysis server URL (paste into the app's Settings):"
echo "    $URL"
echo "==> Health check (first hit can wait on the Let's Encrypt issuance):"
curl -s --max-time 60 "$URL/health" || echo "(container still starting — retry in ~1 min)"
echo
