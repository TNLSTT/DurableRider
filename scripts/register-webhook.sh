#!/usr/bin/env bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to construct the JSON payload" >&2
  exit 1
fi

if [[ -z "${STRAVA_CLIENT_ID:-}" || -z "${STRAVA_CLIENT_SECRET:-}" || -z "${WEBHOOK_PUBLIC_URL:-}" ]]; then
  echo "STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, and WEBHOOK_PUBLIC_URL must be set" >&2
  exit 1
fi

if [[ -z "${STRAVA_VERIFY_TOKEN:-}" ]]; then
  echo "STRAVA_VERIFY_TOKEN must be set to match server verification token" >&2
  exit 1
fi

PAYLOAD=$(jq -n \
  --arg client_id "$STRAVA_CLIENT_ID" \
  --arg client_secret "$STRAVA_CLIENT_SECRET" \
  --arg callback_url "$WEBHOOK_PUBLIC_URL/webhook" \
  --arg verify_token "$STRAVA_VERIFY_TOKEN" \
  '{client_id: $client_id, client_secret: $client_secret, callback_url: $callback_url, verify_token: $verify_token}')

curl -X POST "https://www.strava.com/api/v3/push_subscriptions" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"
