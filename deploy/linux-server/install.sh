#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/fluentcal"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> 检查 Node.js (>= 18)"
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 node，正在尝试自动安装 Node.js 22 LTS..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
    sudo dnf install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
    sudo yum install -y nodejs
  else
    echo "请先手动安装 Node.js 18+ 后重试。"
    exit 1
  fi
fi

echo "==> 部署文件到 ${APP_DIR}"
sudo mkdir -p "${APP_DIR}/data" "${APP_DIR}/public"
sudo cp "${SCRIPT_DIR}/server.mjs" "${APP_DIR}/server.mjs"
sudo rm -rf "${APP_DIR}/public"
sudo cp -r "${SCRIPT_DIR}/public" "${APP_DIR}/public"

if [ ! -f "${APP_DIR}/fluentcal.env" ]; then
  RAND_PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16 || echo 'FluentCal2026')"
  sudo cp "${SCRIPT_DIR}/fluentcal-server.env.example" "${APP_DIR}/fluentcal.env"
  sudo sed -i "s|请改成你的强密码|${RAND_PASS}|" "${APP_DIR}/fluentcal.env"
  sudo chmod 600 "${APP_DIR}/fluentcal.env"
  echo "==> 已自动生成初始密码：${RAND_PASS}（保存在 ${APP_DIR}/fluentcal.env）"
else
  echo "==> 保留已有配置文件 ${APP_DIR}/fluentcal.env"
fi

echo "==> 配置 systemd 开机自启"
sudo cp "${SCRIPT_DIR}/fluentcal-server.service" /etc/systemd/system/fluentcal-server.service
sudo systemctl daemon-reload
sudo systemctl enable --now fluentcal-server
sudo systemctl restart fluentcal-server

echo "==> 部署完成！查看状态："
sudo systemctl status fluentcal-server --no-pager -l | head -n 15
