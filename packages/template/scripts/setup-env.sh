#!/usr/bin/env bash
# setup-env.sh — called by CI before npx qflow run
# Add your environment setup here: Docker, DB migrations, seed data, etc.
# The Runner Agent will not touch this — it runs AFTER this script completes.

set -euo pipefail

echo "[setup-env] Starting environment setup..."

# Example: start a Docker Compose stack
# docker compose -f docker-compose.test.yml up -d --wait

# Example: run DB migrations
# npx prisma migrate deploy

# Example: seed test data
# node scripts/seed-test-data.js

echo "[setup-env] Environment ready."
