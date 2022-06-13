#!/bin/bash
set -eo pipefail

find dist/esm -type f -name '*.d.ts' -delete
find dist/iife -type f -name '*.d.ts' -delete

cp package.json dist/
cp README.md dist/
cp LICENSE-MIT dist/
cp LICENSE-APACHE dist/

cd dist

if [[ "$LIVE" != "1" ]]
then
  EXTRA_FLAGS="--dry-run"
fi

npm publish \
  --access public \
  $EXTRA_FLAGS
