#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# ZFS Snapshot Explorer - TrueNAS Deployment Script
# ==============================================================================
# Synchronizes the project directory to TrueNAS over SSH and triggers
# 'docker compose up -d --build' without requiring an external container registry.
#
# Usage:
#   ./scripts/deploy-truenas.sh [USER@HOST] [REMOTE_DIR]
#
# Examples:
#   ./scripts/deploy-truenas.sh root@truenas
#   ./scripts/deploy-truenas.sh root@192.168.1.100 /mnt/data/apps/custom-apps/zfs-snapshot-explorer
# ==============================================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_DIR}"

# Load environment variables from local .env if present (ignored by Git)
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

TRUENAS_HOST="${1:-${TRUENAS_HOST:-root@truenas.local}}"
REMOTE_DIR="${2:-${REMOTE_DIR:-/opt/zfs-snapshot-explorer}}"

echo "🚀 Deploying ZFS Snapshot Explorer to TrueNAS..."
echo "   Target Host: ${TRUENAS_HOST}"
echo "   Target Dir:  ${REMOTE_DIR}"
echo ""

# 1. Ensure remote directory exists
echo "📁 Ensuring remote directory exists..."
ssh "${TRUENAS_HOST}" "mkdir -p '${REMOTE_DIR}'"

# 2. Rsync project files (excluding runtime/local artifacts)
echo "📦 Synchronizing files via rsync..."
rsync -avz --delete \
    --filter=':- .gitignore' \
    --exclude='.git/' \
    --exclude='.venv/' \
    --exclude='__pycache__/' \
    --exclude='*.pyc' \
    --exclude='scratch/' \
    --exclude='.agents/' \
    --exclude='/config.yaml' \
    --exclude='/.env' \
    ./ "${TRUENAS_HOST}:${REMOTE_DIR}/"

# 3. Build and start container on TrueNAS using examples/truenas/docker-compose.yaml
echo "🔨 Building and starting container via Docker Compose..."
ssh "${TRUENAS_HOST}" "cd '${REMOTE_DIR}' && docker compose -f examples/truenas/docker-compose.yaml up -d --build --force-recreate"

echo ""
echo "✅ Deployment completed successfully!"
echo "   Container logs:"
ssh "${TRUENAS_HOST}" "cd '${REMOTE_DIR}' && docker compose -f examples/truenas/docker-compose.yaml logs -f"
