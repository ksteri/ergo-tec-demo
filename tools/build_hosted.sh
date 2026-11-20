#!/bin/sh
# Builds a self-contained copy for static hosting (claude.ai artifact or any
# static web host): app files at the root, data/ and documents/ beside them.
# Usage: tools/build_hosted.sh <output-dir>
set -e
OUT="${1:?usage: tools/build_hosted.sh <output-dir>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$ROOT/app/js" "$ROOT/app/vendor" "$ROOT/app/styles.css" "$OUT/"
cp -R "$ROOT/data" "$ROOT/documents" "$OUT/"
# Page served from the root: data lives at ./data, not ../data.
sed -e 's|<head>|<head>\
  <meta name="devoreo-base" content=".">|' "$ROOT/app/index.html" > "$OUT/index.html"
# Some hosts reject a literal U+FFFD; inside pdf-lib it only occurs in string
# literals, where the escape is equivalent.
python3 -c "import sys;p=sys.argv[1];s=open(p,encoding='utf-8').read();open(p,'w',encoding='utf-8').write(s.replace(chr(0xfffd),'\\\\uFFFD'))" "$OUT/vendor/pdf-lib.min.js"
echo "Hosted copy written to $OUT"
