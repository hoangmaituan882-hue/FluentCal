# FluentCal Linux 服务器部署指南（零 Docker · 支持 Cloudflare 代理）

本目录是打包好的零依赖单进程服务端（仅依赖 Linux 上的 Node.js 18+，无需 `npm install`，无需数据库），同时提供：
1. **iPad / 网页端完整日历与甘特图**（支持离线缓存、页内弹窗编辑/设置、触屏点击/长按、PWA 添加到主屏幕）
2. **Windows 桌面端兼容 WebDAV 同步接口**（`/dav/`，电脑端原版软件直接可用）

---

## 一、 一键部署到 Linux 服务器

1. 将整个 `linux-server` 文件夹上传到服务器（例如 `/tmp/linux-server`）。
2. 在服务器上执行安装脚本：
   ```bash
   cd /tmp/linux-server
   chmod +x install.sh
   ./install.sh
   ```
   脚本会自动：
   - 把程序放到 `/opt/fluentcal/`
   - 生成 `/opt/fluentcal/fluentcal.env` 并随机生成初始密码（可随时修改 `AUTH_USER` / `AUTH_PASSWORD` 后 `sudo systemctl restart fluentcal-server`）
   - 注册并启动 `fluentcal-server` systemd 服务（监听 `127.0.0.1:8080`）

---

## 二、 绑定你的域名（Cloudflare 代理）

根据你服务器当前对外暴露方式二选一（**推荐方案 1：Cloudflare Tunnel，不用开防火墙端口也不用装 Nginx/Caddy**）：

### 方案 1：Cloudflare Tunnel（`cloudflared`，最省事）
在 Cloudflare Zero Trust 控制台创建 Tunnel 后，直接将你的域名（例如 `cal.你的域名.com`）指向：
- Service Type: `HTTP`
- URL: `127.0.0.1:8080`

### 方案 2：Cloudflare DNS 橙云代理 + Nginx / Caddy
- **若使用 Caddy**：参考同目录 `Caddyfile.example`；Cloudflare SSL/TLS 模式设为 **完全（Full）** 或 **完全（严格）**（切勿设为“灵活/Flexible”，否则会产生重定向循环）。
- **若已有 Nginx**：参考同目录 `nginx.conf.example`；后端 `server.mjs` 已默认输出 `Cache-Control: no-store, no-transform` 并兼容强/弱 `ETag`，可防止 Cloudflare 压缩或改写破坏 WebDAV 同步校验。
- **Cloudflare 建议**：若电脑端同步遇到 WebDAV `MKCOL`/`PUT` 被拦截，可在 Cloudflare 控制台确认没有额外 WAF 规则拦截 `PUT`/`MKCOL` 请求。

---

## 三、 连接电脑端与 iPad

### 1. Windows 电脑端（我们刚本地部署的桌面版）
1. 打开 FluentCal → **设置 → 同步**。
2. 选择 **WebDAV**，填写：
   - **服务器地址**：`https://cal.你的域名.com/dav/`
   - **用户名**：`fluentcal`（与 `fluentcal.env` 一致）
   - **密码**：`fluentcal.env` 里的 `AUTH_PASSWORD`
   - **文件夹**：`FluentCal`（或留空）
3. 点击 **测试连接并开启同步**。

### 2. iPad Safari（网页浏览 + 编辑 + 主屏幕 App）
1. 在 iPad Safari 打开 `https://cal.你的域名.com/`。
2. 输入账号密码登录即可使用与电脑端一致的界面；点任务即可编辑，长按任务/日期格弹出快捷操作菜单，点选中日期右上角 `+` 可快速新建。
3. 点击 Safari 分享按钮 → **添加到主屏幕**，即可全屏无地址栏使用，且支持断网查看/编辑，恢复网络后自动合并同步。
