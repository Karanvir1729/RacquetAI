#!/usr/bin/env bash
# One-shot deploy of the RacquetIQ web app to Azure Static Web Apps (Free tier
# — no hourly cost, unlike the analysis container). Prereq: `az login` done.
# Builds web/dist locally, then uploads it with the SWA CLI using the app's
# deployment token — no GitHub wiring required.
#
#   bash web/deploy-azure.sh            # build + deploy / update
#   bash web/deploy-azure.sh --status   # show state + URL
#   bash web/deploy-azure.sh --down     # delete the static web app
#
# The site serves at https://racketiq.tech and https://www.racketiq.tech. DNS
# is Azure DNS, not the registrar, and the apex is an ALIAS record targeting
# this app — see docs/10-domain-and-dns.md before touching either.
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
# Bake the analysis server's public HTTPS URL (same subscription-hash label
# scheme as analysis/deploy-azure.sh) so the live site works out of the box;
# visitors can still point elsewhere at runtime from the Analyze page.
SUB_ID=$(az account show --query id -o tsv)
SUFFIX=$(printf "%s" "$SUB_ID" | shasum | cut -c1-6)
ACI_LOC="${RACQUETIQ_AZ_LOCATION:-eastus}"
API_BASE="${RACQUETIQ_WEB_API:-https://racquetiq-${SUFFIX}.${ACI_LOC}.azurecontainer.io}"
echo "    VITE_ANALYSIS_API=${API_BASE}"
VITE_ANALYSIS_API="$API_BASE" npm run build --prefix "$SCRIPT_DIR"

echo "==> Uploading dist via the SWA CLI"
TOKEN=$(az staticwebapp secrets list -n "$APP" -g "$RG" --query properties.apiKey -o tsv)
npx --yes @azure/static-web-apps-cli@2 deploy "$SCRIPT_DIR/dist" \
  --deployment-token "$TOKEN" --env production

HOST=$(az staticwebapp show -n "$APP" -g "$RG" --query defaultHostname -o tsv)
echo
echo "==> Deployed. Public URL:"
echo "    https://${HOST}"
