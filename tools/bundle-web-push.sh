#!/bin/sh
# Regénère supabase/functions/send-reminders/web-push.js à partir des versions figées
# de tools/web-push/package-lock.json (installation vérifiée par empreintes : npm ci).
# À faire seulement pour une mise à jour volontaire de web-push, puis relire le diff.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
cp "$ROOT/tools/web-push/package.json" "$ROOT/tools/web-push/package-lock.json" "$TMP/"
cd "$TMP"
npm ci --ignore-scripts --no-audit --no-fund
echo "export { default } from 'web-push';" > entry.mjs
./node_modules/.bin/esbuild entry.mjs --bundle --platform=node --format=esm --target=es2022 --legal-comments=inline \
  --banner:js="// web-push 3.6.7 et ses dépendances (versions figées, voir tools/bundle-web-push.sh). Généré, ne pas modifier.
import { createRequire as __cr } from 'node:module'; import { Buffer } from 'node:buffer'; import process from 'node:process';
const require = __cr(import.meta.url);" \
  --outfile="$ROOT/supabase/functions/send-reminders/web-push.js"
sha256sum "$ROOT/supabase/functions/send-reminders/web-push.js"
