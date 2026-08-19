#!/usr/bin/env bash
# One-shot deploy of the RacquetIQ web app to Azure Static Web Apps (Free tier
# — no hourly cost, unlike the analysis container). Prereq: `az login` done.
# Builds web/dist locally, then uploads it with the SWA CLI using the app's
# deployment token — no GitHub wiring required.
#
#   bash web/deploy-azure.sh            # build + deploy / update
#   bash web/deploy-azure.sh --status   # show state + URL
#   bash web/deploy-azure.sh --down     # delete the static web app
set -euo pipefail

RG="racquetiq-rg"
# Static Web Apps is only offered in a handful of regions; eastus2 is the
# closest to the analysis container's eastus. The region only pins metadata —
# content is served from a global edge either way.
LOC="${RACQUETIQ_SWA_LOCATION:-eastus2}"
APP="racquetiq-web"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--status" ]]; then
  az staticwebapp show -n "$APP" -g "$RG" \
    --query "{name:name, sku:sku.name, host:defaultHostname}" -o table
  echo "URL: https://$(az staticwebapp show -n "$APP" -g "$RG" --query defaultHostname -o tsv)"
  exit 0
fi

if [[ "${1:-}" == "--down" ]]; then
  az staticwebapp delete -n "$APP" -g "$RG" --yes
  echo "Static web app deleted. Redeploy with: bash web/deploy-azure.sh"
  exit 0
fi

echo "==> Resource group $RG"
az group show -n "$RG" -o none 2>/dev/null || az group create -n "$RG" -l "$LOC" -o none

echo "==> Static web app $APP ($LOC, Free tier)"
# Static Web Apps live under the Microsoft.Web provider; a fresh subscription
# has never registered it. Idempotent and quick once registered.
az provider register --namespace Microsoft.Web --wait -o none
az staticwebapp show -n "$APP" -g "$RG" -o none 2>/dev/null \
  || az staticwebapp create -n "$APP" -g "$RG" -l "$LOC" --sku Free -o none

echo "==> Building web/dist"
npm run build --prefix "$SCRIPT_DIR"

echo "==> Uploading dist via the SWA CLI"
TOKEN=$(az staticwebapp secrets list -n "$APP" -g "$RG" --query properties.apiKey -o tsv)
npx --yes @azure/static-web-apps-cli@2 deploy "$SCRIPT_DIR/dist" \
  --deployment-token "$TOKEN" --env production

HOST=$(az staticwebapp show -n "$APP" -g "$RG" --query defaultHostname -o tsv)
echo
echo "==> Deployed. Public URL:"
echo "    https://${HOST}"
