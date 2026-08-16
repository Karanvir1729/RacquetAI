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

if [[ "${1:-}" == "--status" ]]; then
  az container show -g "$RG" -n "$CONTAINER" \
    --query "{state:instanceView.state, fqdn:ipAddress.fqdn, ip:ipAddress.ip}" -o table
  echo "URL: http://${DNS_LABEL}.${LOC}.azurecontainer.io:8082"
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

echo "==> Building image in Azure (a few minutes)"
az acr build -r "$ACR" -t "$IMAGE_TAG" "$SCRIPT_DIR" -o none

echo "==> Starting container ($CPU vCPU / ${MEMORY}GB)"
ACR_USER=$(az acr credential show -n "$ACR" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR" --query 'passwords[0].value' -o tsv)
az container create -g "$RG" -n "$CONTAINER" \
  --image "${ACR}.azurecr.io/${IMAGE_TAG}" \
  --registry-login-server "${ACR}.azurecr.io" \
  --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
  --cpu "$CPU" --memory "$MEMORY" --ports 8082 --os-type Linux \
  --dns-name-label "$DNS_LABEL" --restart-policy Always -o none

URL="http://${DNS_LABEL}.${LOC}.azurecontainer.io:8082"
echo
echo "==> Deployed. Analysis server URL (paste into the app's Settings):"
echo "    $URL"
echo "==> Health check:"
curl -s --max-time 20 "$URL/health" || echo "(container still starting — retry in ~1 min)"
echo
