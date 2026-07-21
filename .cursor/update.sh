#!/usr/bin/env bash
# Cursor Cloud update script (environment.json "install").
# Must be idempotent: may re-run on partially cached snapshots.
set -euo pipefail

cd "$(dirname "$0")/.."

# Use the packageManager from package.json (Yarn 4.x) instead of any
# globally installed Yarn classic.
corepack enable

yarn install

# Snap builds (mm-snap / SES evaluation) require packages/snap/.env.
if [[ ! -f packages/snap/.env ]]; then
  cp packages/snap/.env.example packages/snap/.env
fi
