#!/bin/bash

# ==============================================================================
# My Admin Test1 停机联合部署脚本 (Downtime Deployment)
#
# 用途：当同时修改“数据库表结构(Migration)”和“Edge Functions 代码”且存在强依赖时使用。
# 原理：先停止 Edge Functions，执行迁移与 Web 更新，再同步并重启 Edge Functions。
#
# 用法: ./deploy-downtime.sh <version>
# 示例: ./deploy-downtime.sh v1.0.5
# ==============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-latest}"

log() { echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $*"; }

echo ""
echo "=========================================================="
echo "  My Admin Test1 Coordinated Downtime Deployment"
echo "=========================================================="
echo "Version targeting: $VERSION"
echo ""

log "Step 0: Pulling latest repository code..."
git pull origin main || warn "git pull failed or not in a git repository"

log "Step 1: Safely stopping old Edge Functions..."
if docker ps -a --format '{{.Names}}' | grep -q "^supabase-edge-functions$"; then
    docker stop supabase-edge-functions
    log "Edge Functions container stopped."
else
    warn "Container supabase-edge-functions not found. Skipping stop."
fi

log "Step 2: Running deploy.sh (Database migrations & Web update)..."
cd "$SCRIPT_DIR"
./deploy.sh "$VERSION"

log "Step 3: Syncing new Edge Function code and starting container..."
chmod +x ./sync-edge-functions.sh
./sync-edge-functions.sh

echo ""
echo "=========================================================="
echo -e "${GREEN}  Coordinated Downtime Deployment Completed!${NC}"
echo "=========================================================="
