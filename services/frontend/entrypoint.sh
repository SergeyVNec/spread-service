#!/bin/sh
# Inject runtime env vars into Next.js
# Replaces placeholder in built JS files with actual values

API_URL="${NEXT_PUBLIC_API_URL:-http://spread.46.225.6.40.nip.io}"

# Find and replace placeholder in standalone build
find .next/static -name '*.js' -exec \
  sed -i "s|NEXT_PUBLIC_API_URL_PLACEHOLDER|${API_URL}|g" {} \; 2>/dev/null || true

exec node server.js
