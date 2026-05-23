# 多人在线 DND 文字游戏（V1）

本仓库是一个 monorepo：
- `packages/shared`：房间事件协议（Socket.IO）与共享类型
- `apps/server`：中心服务器（HTTP + Socket.IO）
- `apps/desktop`：桌面端 UI（Vue3 + Vite；先以 Web UI 形态运行，后续再包进 Electron）

## 本地启动（开发）

1. 安装依赖（仓库根目录）：
```bash
npm install
```

2. 启动 Postgres（需要本机已安装 Docker Desktop）：
```bash
docker compose up -d
```

3. 配置服务端环境变量：
- 复制 `apps/server/.env.example` 为 `apps/server/.env`
- 按需修改 `DATABASE_URL` / `JWT_SECRET` / `DEEPSEEK_API_KEY` / `BOT_TOKEN`

4. 初始化数据库（Prisma migrate）：
```bash
npm run prisma:migrate --workspace @dnd/server
```

5. 启动开发环境（会同时启动 shared/server/desktop）：
```bash
npm run dev
```

如果你只想单独启动某个模块：
```bash
npm run dev:server
npm run dev:desktop
npm run dev:admin
npm run dev:onebot
```

默认端口：
- server: http://localhost:8787
- desktop: http://localhost:5173
- admin: http://localhost:5174

## 上服务器运行（测试/最小部署）

适合“先跑起来验证功能”的部署方式：`server + postgres + onebot-adapter(可选)` 都作为独立进程运行；`desktop/admin` 用 Vite build 后作为静态页面由 Nginx 托管（或先用 `vite preview` 简化验证）。

### 0) 前置要求
- Linux 服务器（建议 Ubuntu 22.04+）
- Git（用于拉代码）
- Node.js 20 LTS（用于构建/运行；最省心）
- Docker（用于跑 Postgres；或你也可以用云数据库替代）
- （推荐）Nginx + HTTPS

## 一键 Docker 部署（推荐，最简）

如果你希望把“Node/npm/prisma/nginx”等环境差异全部屏蔽掉，推荐用 Docker Compose 一键起整套：
- postgres
- server（会自动 `prisma migrate deploy`）
- web（desktop + admin 静态站点 + nginx 反代 websocket）
- onebot-adapter（可选 profile，想开 QQ 才启动）

### 0) 一键脚本（无需手改 .env，推荐）

```bash
bash deploy/deploy.sh up
```

这个脚本会：
- 自动生成根目录 `.env`（随机生成 `JWT_SECRET` / `BOT_TOKEN` / `POSTGRES_PASSWORD`）
- 启动 postgres + server + web（desktop/admin/nginx）
- `DEEPSEEK_API_KEY` 默认留空，你可以部署完成后在 Admin 控制台里设置（无需改 .env）

启用 OneBot（可选）：
```bash
bash deploy/deploy.sh up-onebot
```

查看日志 / 停止：
```bash
bash deploy/deploy.sh logs
bash deploy/deploy.sh down
```

### 1) 手动方式（可选）
如果你不想用脚本，也可以手动准备 `.env`：
```bash
cp .env.prod.example .env
```
编辑 `.env`，至少改：
- `JWT_SECRET`
- `BOT_TOKEN`
- `DEEPSEEK_API_KEY`（也可以后续在 Admin Web 中设置）

### 2) 启动（默认不启 OneBot）
```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

访问：
- Web（desktop）：http://你的服务器IP/
- Admin：http://你的服务器IP/admin/
- Server health：http://你的服务器IP/api/health

### 3) 启动 OneBot 适配器（可选）
```bash
docker compose -f docker-compose.prod.yml --env-file .env --profile onebot up -d --build
```

### 4) 查看日志 / 停止
```bash
docker compose -f docker-compose.prod.yml --env-file .env logs -f --tail=200
# 停止
docker compose -f docker-compose.prod.yml --env-file .env down
```

### 5) 国内网络：Docker 镜像拉取慢怎么办？
建议配置 Docker 镜像加速（以 DaoCloud 为例）：
```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "registry-mirrors": ["https://docker.m.daocloud.io"]
}
JSON
sudo systemctl daemon-reload
sudo systemctl restart docker
```

### 0.1) 服务器完全没有开发环境怎么办？（从 0 到能跑）

下面按 Ubuntu 举例，把基础环境一次装齐（Git + Docker + Node.js）。
考虑国内网络环境：GitHub / get.docker.com / registry.npmjs.org 可能会很慢或不可达，因此这里提供“可直接替换为国内镜像”的做法。

#### 0.1.0（可选）切换 Ubuntu apt 国内源
如果 `apt-get update` 很慢，可以先切 apt 源（任选其一：阿里云/清华/中科大等），再继续后面的安装。

#### 0.1.1 安装基础依赖
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git
```

#### 0.1.2 安装 Docker（国内网络推荐用 DaoCloud 镜像）

方法 A（推荐，适合国内）：DaoCloud 一键安装脚本
```bash
curl -fsSL https://get.daocloud.io/docker | sudo sh
```

方法 B（国际网络通畅时）：官方脚本
```bash
curl -fsSL https://get.docker.com | sudo sh
```

安装后把当前用户加入 docker 组并验证：
```bash
sudo usermod -aG docker $USER
newgrp docker
docker version
docker compose version
```

#### 0.1.3 安装 Node.js 20（推荐用 nvm + 国内 Node 镜像）

1) 安装 nvm（如果 GitHub 访问慢，建议先在本机下载脚本再 scp 到服务器执行）
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
```

2) 配置 nvm 使用国内 Node 下载镜像（二选一）
```bash
# npmmirror（推荐）
export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node/

# 或清华镜像
# export NVM_NODEJS_ORG_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/
```

3) 安装并使用 Node 20
```bash
nvm install 20
nvm use 20
node -v
npm -v
```

#### 0.1.4 配置 npm 国内镜像（强烈推荐）
```bash
npm config set registry https://registry.npmmirror.com
```

（可选）安装 PM2 便于守护进程：
```bash
npm i -g pm2
```

#### 0.1.5（推荐）安装 Nginx + 防火墙放行端口
```bash
sudo apt-get install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

如果你启用了 UFW（Ubuntu 常见），放行 80/443（以及你需要的额外端口）：
```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# 如需 OneBot 反向WS（ADAPTER_PORT，默认 6700）：
# sudo ufw allow 6700/tcp
sudo ufw enable
sudo ufw status
```

#### 0.1.6（可选）HTTPS 证书（Certbot）
如果你的服务器能直接访问 Let’s Encrypt（国内有时不稳定），可用：
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com
```
如果 Let’s Encrypt 不稳定，建议改用你已有的证书或云厂商证书服务。

### 1) 部署 Postgres
```bash
docker compose up -d
```

### 2) 配置服务端环境变量
在服务器上创建 `apps/server/.env`（可从 `.env.example` 复制）：
- `DATABASE_URL`：指向你的 Postgres
- `JWT_SECRET`：用于签发 JWT（务必改成随机长串）
- `DEEPSEEK_API_KEY`：用于 DM（也可以后续在 Admin Web 中设置/替换）
- `BOT_TOKEN`：用于 Bot API（OneBot adapter 调用主服务用；可为空，空则 Bot API 直接不可用）

### 3) 安装依赖并构建
```bash
npm install
npm run build
```

> 如果你从 GitHub 拉代码很慢，建议：
> - 把仓库镜像到 Gitee 再 `git clone`（最稳）
> - 或在本地打包代码传到服务器（scp/rsync）
> - npm 依赖已在上面设置为 npmmirror，会明显改善安装速度

### 4) 数据库迁移（生产/服务器建议用 deploy）
```bash
npm run prisma:deploy --workspace @dnd/server
```

如果你还没有 migrations，先用：
```bash
npm run prisma:push --workspace @dnd/server
```

### 5) 启动服务端
简单测试：
```bash
npm run start --workspace @dnd/server
```

长期运行建议用 PM2 / systemd / Docker（任选其一）。

PM2 示例（推荐先用它“跑起来测试”）：
```bash
pm2 start 'npm run start --workspace @dnd/server' --name dnd-server
pm2 save
pm2 startup
```

### 6) 部署 desktop/admin（静态页面）
构建产物：
- `apps/desktop/dist`
- `apps/admin/dist`

最小验证：你可以先用 `vite preview` 跑起来（不推荐长期使用）：
```bash
npm run preview --workspace @dnd/desktop
npm run preview --workspace @dnd/admin
```

更推荐：用 Nginx 直接托管 dist 目录。

### 7) Nginx 反代（含 WebSocket）示例
下面示例把：
- `https://example.com/` -> desktop
- `https://example.com/admin/` -> admin
- `https://example.com/api/` & `wss://example.com/socket.io/` -> server

（注意替换域名与 dist 目录路径）
```nginx
server {
  listen 80;
  server_name example.com;

  # desktop
  root /var/www/dnd/desktop/dist;
  location / {
    try_files $uri $uri/ /index.html;
  }

  # admin
  location /admin/ {
    alias /var/www/dnd/admin/dist/;
    try_files $uri $uri/ /admin/index.html;
  }

  # server http api
  location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  # socket.io websocket
  location /socket.io/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

## OneBot 适配器（与主程序隔离的模块）

适配器是一个独立进程：`apps/onebot-adapter`，你可以单独启动/关闭它来“开关 QQ 接入”。

1. 复制 `apps/onebot-adapter/.env.example` 为 `apps/onebot-adapter/.env`
2. 配置：
   - `DND_SERVER_URL`：主服务地址
   - `BOT_TOKEN`：与主服务的 Bot API 密钥（在 `apps/server/.env` 里配置 `BOT_TOKEN`）
   - `ADAPTER_PORT`：适配器反向 WS 监听端口（OneBot 连接到这里）
3. 单独启动适配器：
```bash
npm run dev:onebot
```
服务器上长期运行：
```bash
npm run start --workspace @dnd/onebot-adapter
```

### 群-房间绑定
- 在 Admin Web 里配置（后台会写入数据库）。
- 适配器会每 15 秒自动刷新绑定列表并订阅新房间。

## 功能概览（当前）
- 临时“开发登录”（输入用户名即可获取 token）
- 创建房间 / 加入房间（房间 id，桌面端可一键创建）
- 房间实时聊天（Socket.IO）
- 调用 DeepSeek 作为 DM（支持流式输出；需要配置 `DEEPSEEK_API_KEY`）
- 剧本（Markdown）版本化导入（后端 API 已提供）
- Campaign：可绑定剧本版本、存档/读档（后端 API 已提供）
- 掷骰：支持 `d20` / `2d6+3` 等简单表达式（结果落库并广播）
- Admin Web（基础版）：数据概览 + 功能开关/OneBot 基础配置（需管理员权限）

## 管理员权限

1. 先通过“注册”创建一个带 email 的用户，并登录拿到 token。
2. 将该用户提升为 ADMIN：
```bash
npm run admin:promote --workspace @dnd/server -- --email you@example.com
```
3. 用管理员 token 打开 Admin Web（http://localhost:5174），即可访问后台接口。

## 模块化开关（在 Admin Web 中配置）

在 Admin Web 的“系统设置”中可以统一开关各模块（便于维护/排错/灰度）：
- `DeepSeek DM`：关闭后，房间内“请求DM”会直接提示模块已关闭
- `Bot API`：关闭后，`/api/bot/*` 全部返回 503（OneBot 适配器无法工作）
- `OneBot 模块`：关闭后，即使 onebot-adapter 进程仍在运行也不会转发消息
- `道具图片资源`：关闭后服务端返回 `imageUrl=null`，前端可按此隐藏图片展示

## DeepSeek 配置（在 Admin Web 中配置）

你可以在 Admin Web 的系统设置中配置：
- `DeepSeek Base URL`
- `DeepSeek 模型名称`
- `DeepSeek API Key`

安全说明：
- 后台不会回显已保存的 API Key（只显示“是否已配置”）
- 留空 Key 输入框并保存：表示“保持不变”
- 勾选“清空 Key”：会清除已保存的 key（DM 将不可用）

## 关于 JWT_SECRET / BOT_TOKEN 的“免手改”说明

- 使用 `bash deploy/deploy.sh up` 时，会自动生成随机的 `JWT_SECRET` 与 `BOT_TOKEN` 并写入根目录 `.env`。
- 你一般不需要手动改它们（除非你要“更换密钥/全员重新登录/重置机器人鉴权”）。
- `BOT_TOKEN` 是 OneBot 适配器与主服务 Bot API 的鉴权密钥：如果你启用了 OneBot，请保持 onebot-adapter 与 server 使用同一个 BOT_TOKEN（脚本会自动保证一致）。

## 资源系统（可开关、与核心逻辑解耦）

目前实现的是“资源注册 + 道具/装备绑定图片”的最小接口，后续你可以替换为真正的资源上传/图床/CDN 管理。

- Admin Web 中可管理：
  - Assets：`key -> url`（url 可以是绝对URL，也可以是相对路径）
  - Items：道具/装备，支持绑定 `imageAssetKey`
- 开关：
  - `features.enableItemImages`（Admin Web 中可配置）
  - 关闭时：服务端仍返回道具数据，但 `imageUrl` 一律为 `null`（便于一键禁用图片资源功能）
- 拼接规则：
  - 若 Asset.url 是绝对 URL：直接使用
  - 若是相对路径：会与 `assets.baseUrl` 拼接

提示：新增了 `Asset/Item` 表，需要再次执行一次数据库迁移：
```bash
npm run prisma:migrate --workspace @dnd/server
```

## 备注
- 本项目是“模块化/可开关”设计：`onebot-adapter`、资源系统等都可以作为独立模块启停，主服务通过受控 API 与密钥进行集成。
