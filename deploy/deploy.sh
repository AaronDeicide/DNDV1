#!/usr/bin/env bash
set -euo pipefail

# 一键部署脚本：
# - 自动生成 .env（JWT_SECRET / BOT_TOKEN / POSTGRES_PASSWORD 等）
# - 一键启动 docker compose（prod）
# - 国内网络：可选配置 Docker 镜像加速（见 README）

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
ENV_EXAMPLE="${ROOT_DIR}/.env.prod.example"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"

rand() {
  # 生成一个足够随机的字符串（优先 openssl，其次 /dev/urandom）
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

ensure_env() {
  if [[ -f "${ENV_FILE}" ]]; then
    return 0
  fi

echo "[deploy] 未找到 .env，自动生成..."
cp "${ENV_EXAMPLE}" "${ENV_FILE}"

JWT_SECRET="$(rand)"
BOT_TOKEN="$(rand)"
POSTGRES_PASSWORD="$(rand)"

# 用 sed 原地替换（Ubuntu 默认有 sed）
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${JWT_SECRET}/" "${ENV_FILE}"
sed -i "s/^BOT_TOKEN=.*/BOT_TOKEN=${BOT_TOKEN}/" "${ENV_FILE}"
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${POSTGRES_PASSWORD}/" "${ENV_FILE}"

echo "[deploy] 已生成 .env（已写入随机 JWT_SECRET/BOT_TOKEN/POSTGRES_PASSWORD）"
echo "[deploy] 注意：DEEPSEEK_API_KEY 默认为空，你可以部署完成后在 Admin 控制台里设置。"
}

up() {
  ensure_env
  echo "[deploy] 启动（不含 OneBot）..."
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d --build
  echo "[deploy] 完成。访问："
  echo "  - Desktop: http://<服务器IP>/"
  echo "  - Admin  : http://<服务器IP>/admin/"
  echo "  - Health : http://<服务器IP>/api/health"
}

up_onebot() {
  ensure_env
  echo "[deploy] 启动（含 OneBot profile）..."
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" --profile onebot up -d --build
  echo "[deploy] 完成。OneBot 反向 WS 端口：\${ADAPTER_PORT}（默认 6700）"
}

down() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "[deploy] 未找到 .env，仍然尝试停止..."
    docker compose -f "${COMPOSE_FILE}" down || true
    return 0
  fi
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" down
}

logs() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    docker compose -f "${COMPOSE_FILE}" logs -f --tail=200
    return 0
  fi
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" logs -f --tail=200
}

case "${1:-}" in
  up) up ;;
  up-onebot) up_onebot ;;
  down) down ;;
  logs) logs ;;
  *)
    echo "用法："
    echo "  bash deploy/deploy.sh up          # 一键启动（不含 OneBot）"
    echo "  bash deploy/deploy.sh up-onebot   # 一键启动（含 OneBot）"
    echo "  bash deploy/deploy.sh logs        # 查看日志"
    echo "  bash deploy/deploy.sh down        # 停止"
    exit 1
    ;;
esac

