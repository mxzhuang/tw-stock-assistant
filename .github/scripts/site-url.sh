#!/usr/bin/env bash
# Print the address Cloudflare actually serves the Pages project on.
#
# <project>.pages.dev is only the address when nobody else had the name first;
# otherwise Cloudflare adds a suffix. Prints nothing when the project does not
# exist yet or the lookup fails, so callers can tell "unknown" from "known".
set -u
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [ -n "${PAGES_PROJECT:-}" ] || exit 0
curl -fsS --max-time 20 \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PAGES_PROJECT" 2>/dev/null \
  | python3 -c '
import json, re, sys
try:
    host = json.load(sys.stdin)["result"]["subdomain"]
except Exception:
    sys.exit(0)
if isinstance(host, str) and re.fullmatch(r"[a-z0-9-]+\.pages\.dev", host):
    print("https://" + host)
' || true
