# 10 — The domain and its DNS

`racketiq.tech` is registered at get.tech (Namify) but its DNS is served by
**Azure DNS**, and the apex is bound directly to the Static Web App. This file
is the map of that, and of the two traps that cost real time setting it up.

## Topology

```
get.tech (registrar)          delegation only — NS records, nothing else
   └─ NS ─> Azure DNS zone `racketiq.tech` (resource group racquetiq-rg)
              ├─ @      A (alias -> the staticSites resource)  ── apex
              ├─ www    CNAME -> kind-sea-0e4afca0f.7.azurestaticapps.net
              └─ _dnsauth TXT  -> the SWA's current validation token
```

Both hostnames are registered as custom domains on the `racquetiq-web` Static
Web App and both serve the same bundle over TLS. `http://` 301s to `https://`
on each.

## Why the DNS is not at the registrar

An apex cannot be a CNAME, so binding `racketiq.tech` (no `www`) to a Static
Web App needs either an ALIAS/ANAME record or CNAME flattening. **get.tech
supports neither.** That is the whole reason the apex was dead from purchase
until 2026-08-21 while `www` worked fine.

get.tech does offer "Domain Forwarding", and a rule was configured there
(`racketiq.tech -> https://www.racketiq.tech`). It never worked: neither of
their nameservers ever published an A record for the apex, so the forwarder
existed in their UI with no effect in DNS. It also *locked the nameserver
editor* — the Edit button is inert until the forwarder is deleted. If DNS ever
moves back, that is the first thing to clear.

Azure DNS was chosen over Cloudflare only because the Azure subscription
already existed; Cloudflare's CNAME flattening would work equally well. The
zone costs about USD 0.50/month.

## The alias record is the point

The apex is an **alias A record targeting the Static Web App resource**, not a
hardcoded IP:

```bash
az network dns record-set a create -g racquetiq-rg -z racketiq.tech -n "@" \
  --target-resource "$(az staticwebapp show -n racquetiq-web -g racquetiq-rg --query id -o tsv)"
```

Azure resolves it to the app's current edge IP and keeps it in sync. Pointing a
plain A record at whatever IP the app answers on today would silently break the
day Azure moves the edge.

## Trap: the validation token rotates

The apex is validated by `dns-txt-token`: Azure issues a token, you publish it
at `_dnsauth.racketiq.tech`, Azure polls for it.

**Deleting and re-adding the custom domain issues a NEW token.** The old TXT
record then no longer matches and validation sits at `Validating` forever
without ever reporting an error — it does not fail loudly, it just never
succeeds. This is the single most confusing failure mode here.

So after any `hostname delete` + `hostname set`, always re-read the token and
republish the TXT before waiting on anything:

```bash
NEW=$(az staticwebapp hostname list -n racquetiq-web -g racquetiq-rg \
  --query "[?name=='racketiq.tech'].properties.validationToken" -o tsv)
OLD=$(az network dns record-set txt show -g racquetiq-rg -z racketiq.tech \
  -n _dnsauth --query "TXTRecords[0].value[0]" -o tsv)
az network dns record-set txt remove-record -g racquetiq-rg -z racketiq.tech -n _dnsauth -v "$OLD"
az network dns record-set txt add-record    -g racquetiq-rg -z racketiq.tech -n _dnsauth -v "$NEW"
```

Once the token matches, `Validating -> Adding -> Ready` and the certificate
issues in about a minute. Leave the TXT record in place: Azure re-checks it on
renewal.

## Trap: do not verify delegation against the TLD servers

`dig +norecurse @<a .tech TLD server> racketiq.tech NS` returns empty from many
networks, which reads as "not delegated yet" when delegation has in fact
already landed. Check public resolvers and whois instead:

```bash
dig +short @1.1.1.1 racketiq.tech NS
whois racketiq.tech | grep -i "name server"
```

## The API hostname, and the certificate quota that forced it

The analysis server is reached at **`api.racketiq.tech`**, a CNAME in this zone
pointing at the ACI FQDN. Caddy serves both names. The site is built against
the `api.` name (`web/deploy-azure.sh` sets `VITE_ANALYSIS_API`).

A CNAME rather than an A record, for the same reason the apex is an alias: the
ACI public IP is not stable. On 2026-08-21 it moved three times in a day
(`20.121.77.189` → `4.156.106.211` → `4.157.21.151`) as the container group was
recreated. An address record would go stale on the very next deploy.

**Let's Encrypt issues at most 5 certificates per exact hostname per 168 hours.**
Until Caddy's `/data` was persisted, every deploy recreated the sidecar with
empty storage, so it asked for a brand-new certificate each time. Five deploys
in a week exhausted the quota for `racquetiq-a7682a.eastus.azurecontainer.io`,
and a completely healthy analysis server became unreachable from an HTTPS page
— `429 ... too many certificates already issued for this exact set of
identifiers`. Nothing was wrong with the server; it simply had no certificate.

Two changes fix it, and they only work together:

- Caddy's `/data` and `/config` are Azure Files shares (`caddy-data`,
  `caddy-config` on storage account `racquetiqa7682a`), so a recreate REUSES
  the certificate instead of requesting one.
- `api.racketiq.tech` is a second hostname with its own untouched quota.

If the API is unreachable over HTTPS but `http://<aci-ip>:8082/health` answers,
this is the failure. Check Caddy: `az container logs -g racquetiq-rg -n
racquetiq-analysis --container-name tls | tail`. A 429 there is a wait, not a
bug — Caddy retries in the background and heals itself once the window opens.

`RACQUETIQ_SKIP_BUILD=1` recreates the container group from the image already
in ACR, for sidecar or YAML-only changes where rebuilding an unchanged image is
pure waiting.

## Adding a module to the analysis server

`analysis/deploy-azure.sh` stages an explicit list of files into the build
context and the Dockerfile does `COPY *.py`, so **the staging list in the deploy
script is the only list**. It did not used to be: the Dockerfile carried a
second explicit `COPY analyze.py server.py platform_api.py`, and adding
`coach_api.py` to neither shipped an image that raised ImportError on boot and
CrashLoopBackOffed — after every local test had passed, because locally the file
is simply present. If a new module ever fails to import in the container, that
staging list is the first thing to check.

## Operations

```bash
# what the zone serves
az network dns record-set list -g racquetiq-rg -z racketiq.tech -o table

# custom-domain state (both hostnames)
az staticwebapp hostname list -n racquetiq-web -g racquetiq-rg -o table

# the four nameservers get.tech must delegate to
az network dns zone show -g racquetiq-rg -n racketiq.tech --query nameServers -o tsv
```

Status alone is not proof the site serves — always finish with a real request:

```bash
curl -sI https://racketiq.tech/ | head -1
```

## Order of operations, if this is ever redone

Records first, cutover second. Build the whole new zone — apex, `www`,
`_dnsauth` — and verify it by querying its own nameservers directly *before*
changing delegation at the registrar. Doing it that way means `www` answers
identically from both the old and new zones throughout, and never goes dark.
