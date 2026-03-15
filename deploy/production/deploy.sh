#!/bin/bash

# My Admin Test1 生产部署脚本
# 用法: ./deploy.sh <version>
# 示例: ./deploy.sh v1.0.5

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-latest}"
REGISTRY="ghcr.io"
GITHUB_REPO="${GITHUB_REPO:-your-org/my-admin-test1}"

DEPLOY_ENV_FILE="$SCRIPT_DIR/.deploy.env"
if [ -f "$DEPLOY_ENV_FILE" ]; then
    # shellcheck disable=SC1090
    source "$DEPLOY_ENV_FILE"
fi

WEB_IMAGE="$REGISTRY/$GITHUB_REPO:$VERSION"
MIGRATOR_IMAGE="$REGISTRY/$GITHUB_REPO-migrator:$VERSION"

log() { echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $*"; }
error() { echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $*"; }

echo ""
echo "=========================================="
echo "  My Admin Test1 Production Deployment"
echo "=========================================="
echo ""
echo "Version:    $VERSION"
echo "Registry:   $REGISTRY"
echo "Repository: $GITHUB_REPO"
echo ""

if ! command -v docker &> /dev/null; then
    error "Docker is not installed"
    exit 1
fi

if [ -z "$DATABASE_URL" ]; then
    error "DATABASE_URL is not set. Please configure .env file."
    exit 1
fi

log "Step 1: Pulling images..."
log "Pulling web image: $WEB_IMAGE"
if ! docker pull "$WEB_IMAGE"; then
    error "Failed to pull web image"
    exit 1
fi
log "Pulling migrator image: $MIGRATOR_IMAGE"
if ! docker pull "$MIGRATOR_IMAGE"; then
    error "Failed to pull migrator image"
    exit 1
fi
log "All images pulled successfully"

log "Step 2: Running database migrations..."
if docker run --rm \
    --network supabase_default \
    -e DATABASE_URL="$DATABASE_URL" \
    "$MIGRATOR_IMAGE"; then
    log "Database migrations completed"
else
    error "Database migration failed"
    echo ""
    echo "You can skip migrations and continue with:"
    echo "  VERSION=$VERSION docker compose up -d"
    exit 1
fi

log "Step 3: Updating services..."
cd "$SCRIPT_DIR"

if docker ps --format '{{.Names}}' | grep -q "my-admin-test1-assistant-web"; then
    warn "Found legacy container my-admin-test1-assistant-web, stopping it before compose up"
    docker rm -f my-admin-test1-assistant-web || true
fi

export VERSION
export GITHUB_REPO

if docker compose up -d; then
    log "Services updated successfully"
else
    error "Failed to update services"
    exit 1
fi

log "Step 4: Running health checks..."
sleep 5

if docker ps --format '{{.Names}}' | grep -q "my-admin-test1-web"; then
    log "Web container is running"
else
    warn "Web container may not be running"
fi

if docker ps --format '{{.Names}}' | grep -q "my-admin-test1-nginx"; then
    log "Nginx container is running"
else
    warn "Nginx container may not be running"
fi

log "Step 5: Recording deployment info..."
cat > "$SCRIPT_DIR/DEPLOYED_VERSION" <<EOF
{
  "version": "$VERSION",
  "web_image": "$WEB_IMAGE",
  "migrator_image": "$MIGRATOR_IMAGE",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployed_by": "$(whoami)"
}
EOF

echo ""
echo "=========================================="
echo -e "${GREEN}  Deployment Completed Successfully!${NC}"
echo "=========================================="
echo ""
echo "Version: $VERSION"
echo "Web:     http://localhost:${WEB_PORT:-80}"
echo ""
echo "Useful commands:"
echo "  docker compose ps          # View running containers"
echo "  docker compose logs -f     # View logs"
echo "  ./deploy.sh v1.0.4         # Rollback to previous version"
echo ""
