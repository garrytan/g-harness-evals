#!/usr/bin/env bash
# Walks a new contributor through the Postmark and Sentry values parcel-pulse needs.
# Writes them to .env and, where CI needs them, to the repository's Actions secrets.
set -euo pipefail

ENV_FILE=".env"
[[ -f "$ENV_FILE" ]] || cp .env.example "$ENV_FILE"

save_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
  echo "  saved ${key} to ${ENV_FILE}"
}

push_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
    printf '%s' "$value" | gh secret set "$name"
    echo "  set GitHub secret ${name}"
  else
    echo "  gh is not logged in; later run: gh secret set ${name}"
  fi
}

echo
echo "Step 1 of 3: Postmark server token"
echo "  Open https://account.postmarkapp.com/servers, pick the parcel-pulse server, open API Tokens."
read -rsp "  Paste the Server API token: " POSTMARK_SERVER_TOKEN; echo
save_env POSTMARK_SERVER_TOKEN "$POSTMARK_SERVER_TOKEN"
push_secret POSTMARK_SERVER_TOKEN "$POSTMARK_SERVER_TOKEN"

echo
echo "Step 2 of 3: Postmark sender address"
echo "  Open https://account.postmarkapp.com/signature_domains and copy the confirmed sender address."
read -rp "  Sender address: " POSTMARK_FROM_EMAIL
save_env POSTMARK_FROM_EMAIL "$POSTMARK_FROM_EMAIL"

echo
echo "Step 3 of 3: Sentry DSN"
echo "  Open https://sentry.io/settings/projects/, pick parcel-pulse, then Client Keys (DSN)."
read -rp "  Paste the DSN: " SENTRY_DSN
save_env SENTRY_DSN "$SENTRY_DSN"
push_secret SENTRY_DSN "$SENTRY_DSN"

echo
echo "Done. Run 'flask --app parcel_pulse run' to check that email and error reporting work."
