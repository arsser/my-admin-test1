#!/usr/bin/env bash
# 同步 Edge Functions 到 Supabase 并重启 functions 服务
# 用法: 在 deploy/production 目录下执行 ./sync-edge-functions.sh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
DEPLOY_ENV_FILE="${SCRIPT_DIR}/.deploy.env"

if [ -f "$DEPLOY_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$DEPLOY_ENV_FILE"
fi

SUPABASE_DIR="${SUPABASE_DIR:-$REPO_DIR}"
SRC_DIR="$REPO_DIR/apps/supabase/functions"
DEST_DIR="$SUPABASE_DIR/volumes/functions"

echo "[sync-edge-functions] REPO_DIR     = $REPO_DIR"
echo "[sync-edge-functions] SUPABASE_DIR = $SUPABASE_DIR"
echo "[sync-edge-functions] SRC_DIR      = $SRC_DIR"
echo "[sync-edge-functions] DEST_DIR     = $DEST_DIR"

if [ ! -d "$SRC_DIR" ]; then
  echo "[sync-edge-functions] ERROR: 源目录不存在: $SRC_DIR" >&2
  exit 1
fi

if [ ! -f "$SUPABASE_DIR/docker-compose.yml" ]; then
  echo "[sync-edge-functions] ERROR: 未在 $SUPABASE_DIR 找到 docker-compose.yml" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

if command -v rsync >/dev/null 2>&1; then
  echo "[sync-edge-functions] 使用 rsync 同步..."
  rsync -av --delete "$SRC_DIR/" "$DEST_DIR/"
else
  echo "[sync-edge-functions] 使用 cp 同步..."
  rm -rf "$DEST_DIR"/*
  cp -a "$SRC_DIR/." "$DEST_DIR/"
fi

echo "[sync-edge-functions] 同步完成。"
ls -R "$DEST_DIR" || true

cd "$SUPABASE_DIR"
echo "[sync-edge-functions] 重启 functions 服务..."
docker compose up -d functions
docker compose ps functions
echo "[sync-edge-functions] 完成。"
