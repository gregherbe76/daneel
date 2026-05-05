#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] Pushing database schema (drizzle-kit push)…"
pnpm --filter @workspace/db run push

echo "[entrypoint] Running idempotent demo seed…"
pnpm --filter @workspace/scripts run seed-demo

echo "[entrypoint] Starting API server on port ${PORT:-3000}…"
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
