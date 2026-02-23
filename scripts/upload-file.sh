#!/bin/bash
# Upload a file to Mission Control via Convex webhook
# Usage: ./upload-to-mission.sh <runId> <filepath> [mimeType]
#
# Env vars (optional):
#   MISSION_AGENT_ID   - agent id (e.g. "jarvis")
#   MISSION_AGENT_NAME - display name
#   MISSION_TASK       - task description

set -euo pipefail

WEBHOOK_URL="${MISSION_WEBHOOK_URL:-https://determined-pig-729.convex.site/openclaw/event}"
WEBHOOK_TOKEN="${MISSION_WEBHOOK_TOKEN:-123bearandbear}"

RUN_ID="${1:?Usage: upload-to-mission.sh <runId> <filepath> [mimeType]}"
FILEPATH="${2:?Usage: upload-to-mission.sh <runId> <filepath> [mimeType]}"
FILENAME=$(basename "$FILEPATH")

# Auto-detect mime type
if [ -n "${3:-}" ]; then
  MIME="$3"
else
  case "$FILENAME" in
    *.md)   MIME="text/markdown" ;;
    *.txt)  MIME="text/plain" ;;
    *.json) MIME="application/json" ;;
    *.html) MIME="text/html" ;;
    *.css)  MIME="text/css" ;;
    *.js)   MIME="application/javascript" ;;
    *.png)  MIME="image/png" ;;
    *.jpg|*.jpeg) MIME="image/jpeg" ;;
    *.gif)  MIME="image/gif" ;;
    *.webp) MIME="image/webp" ;;
    *.pdf)  MIME="application/pdf" ;;
    *)      MIME="application/octet-stream" ;;
  esac
fi

FILESIZE=$(stat -c%s "$FILEPATH" 2>/dev/null || stat -f%z "$FILEPATH" 2>/dev/null || echo 0)
CONTENT_B64=$(base64 -w0 "$FILEPATH" 2>/dev/null || base64 "$FILEPATH" 2>/dev/null)

# Build JSON with optional agent metadata
AGENT_ID="${MISSION_AGENT_ID:-}"
AGENT_NAME="${MISSION_AGENT_NAME:-}"
TASK="${MISSION_TASK:-}"

JSON=$(python3 -c "
import json, sys
d = {
    'type': 'agent_run_file_commit',
    'runId': sys.argv[1],
    'filename': sys.argv[2],
    'mimeType': sys.argv[3],
    'size': int(sys.argv[4]),
    'content': sys.argv[5],
}
if sys.argv[6]: d['agentId'] = sys.argv[6]
if sys.argv[7]: d['agentName'] = sys.argv[7]
if sys.argv[8]: d['task'] = sys.argv[8]
print(json.dumps(d))
" "$RUN_ID" "$FILENAME" "$MIME" "$FILESIZE" "$CONTENT_B64" "$AGENT_ID" "$AGENT_NAME" "$TASK")

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEBHOOK_TOKEN" \
  -d "$JSON")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Uploaded $FILENAME ($MIME, ${FILESIZE}B) for run $RUN_ID"
else
  echo "❌ Failed (HTTP $HTTP_CODE): $BODY" >&2
  exit 1
fi
