#!/bin/bash
# Upload a file to Mission Control via Convex webhook
# Usage: ./upload-file.sh <runId> <filepath> [contentType]
#
# Example:
#   ./upload-file.sh run_abc123 ./output/report.md text/markdown
#   ./upload-file.sh run_abc123 ./output/chart.png image/png

set -euo pipefail

WEBHOOK_URL="${MISSION_WEBHOOK_URL:-https://determined-pig-729.convex.site/openclaw/event}"
WEBHOOK_TOKEN="${MISSION_WEBHOOK_TOKEN:-123bearandbear}"

RUN_ID="${1:?Usage: upload-file.sh <runId> <filepath> [mimeType]}"
FILEPATH="${2:?Usage: upload-file.sh <runId> <filepath> [mimeType]}"
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

JSON=$(cat <<EOF
{
  "type": "agent_run_file_commit",
  "runId": "$RUN_ID",
  "filename": "$FILENAME",
  "mimeType": "$MIME",
  "size": $FILESIZE,
  "content": "$CONTENT_B64"
}
EOF
)

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEBHOOK_TOKEN" \
  -d "$JSON")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Uploaded $FILENAME ($MIME, ${FILESIZE}B) for run $RUN_ID"
else
  echo "❌ Failed (HTTP $HTTP_CODE): $BODY" >&2
  exit 1
fi
