# DNSHE 免费域名统一管理

多账户 DNSHE 免费域名管理 + 租借平台。一套代码同时部署到 **Cloudflare**（Workers + KV）和 **EdgeOne**（Edge Functions + KV）。

## 功能

- **多账户管理**：添加多个 DNSHE API 凭证，凭证 AES-256-GCM 加密存储
- **域名总览**：聚合所有账户的免费域名，搜索 / 筛选 / 排序
- **DNS 管理**：查看、添加、修改、删除 DNS 记录
- **租借系统**：管理员把整个域名，或域名下**更深一层的子域名**（如 `11.xf0.cc.cd`）租借给普通用户，可设到期时间、回收
- **子域名作用域隔离**：租借子域名后，用户只能管理该子域名及其下级的 DNS 记录，且记录名自动映射到作用域内
- **自助申请子域名**：管理员对某域名开启「开放自助」后，普通用户可自行申请子域名（如 `11.xf0.cc.cd`），系统自动租借给他，无需人工审批
- **权限隔离**：普通用户只能看到 / 操作租借给自己的域名或子域名
- **配额监控 / 审计日志 / 用户管理**

### 子域名租借

在「域名」页点击某域名的「租借」，在**子域名前缀**里填 `11`，即把 `11.xf0.cc.cd` 租给该用户：

- 用户可以创建 `@`（= `11.xf0.cc.cd`）、`www`（= `www.11.xf0.cc.cd`）等记录
- 用户无法创建作用域外的记录（如 `evil.xf0.cc.cd`）
- 同一域名可同时租给多个用户不同前缀；`11` 与 `11.a`、整个域名 视为冲突

### 自助申请子域名

1. 管理员在「域名」页对某域名点「开放自助」
2. 普通用户在「域名」页点「自助申请子域名」，选择域名并填写前缀（如 `11`）
3. 系统自动把 `11.xf0.cc.cd` 租借给该用户（先到先得，被占用会提示）
4. 管理员可随时「关闭自助」，或在「租借」页回收

## 架构

```
Next.js 静态导出 (out/)
   ├─ Cloudflare Pages  ──/api/*──▶  CF Worker (Hono)  ──▶  CF KV
   └─ EdgeOne Pages     ──/api/*──▶  Edge Functions    ──▶  EdgeOne KV
```

- **前端**：Next.js `output: 'export'` 纯静态，两端共用，页面渲染 0 函数调用
- **后端**：Hono 共享业务逻辑，仅依赖一个 `Store` 接口，平台适配器实现
- **存储**：Cloudflare KV ↔ EdgeOne KV，统一抽象为 `get/put/del/list`
- **读缓存 / 写实时**：读走 KV，写操作实时提交 DNSHE 并回写缓存
- **惰性同步**：数据超过 6 小时未同步时后台异步同步；CF 另有 6 小时 Cron，EdgeOne 有每日 schedule

## 目录结构

```
src/
├── app/                    # Next.js 页面
├── components/             # UI 组件
├── lib/                    # 前端 API / 认证 / hooks
└── server/                 # 共享后端（零平台依赖）
    ├── app.ts              # Hono 应用与全部路由
    ├── context.ts
    ├── lib/crypto.ts       # PBKDF2 / AES-GCM / JWT
    ├── services/           # dnshe / auth / sync / audit
    └── storage/            # Store 接口 + CF/EO 适配器 + 仓储
cf-worker/                  # Cloudflare Worker 入口 + wrangler.toml
edge-functions/api/         # EdgeOne Edge Functions 入口
edgeone.json                # EdgeOne 配置
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `JWT_SECRET` | ✅ | JWT 签名密钥，任意随机长字符串 |
| `ENCRYPTION_KEY` | ✅ | AES-256-GCM 密钥，base64 编码的 32 字节 |
| `INITIAL_ADMIN_USERNAME` |  | 首次部署自动创建的管理员用户名 |
| `INITIAL_ADMIN_PASSWORD` |  | 首次部署自动创建的管理员密码 |
| `DNSHE_API_BASE` |  | 覆盖 DNSHE API 地址 |
| `CRON_TOKEN` |  | EdgeOne 定时任务调用 `/api/cron` 的令牌 |

> 若未配置 `INITIAL_ADMIN_*`，则**第一个注册的账号自动成为管理员**。

生成加密密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 本地开发

```bash
npm install

# 运行测试（加密 / 仓储 / API 集成，DNSHE 接口已 mock）
npm test

# 真实 DNSHE 接口联调（会读取你账户的真实数据，只读，不修改）
DNSHE_API_KEY=cfsd_xxx DNSHE_API_SECRET=yyy npx vitest run tests/live.test.ts

# 一键同时启动 API + 前端（推荐）
npm run dev:all
```

`npm run dev:all` 会同时启动：

- Worker API：`http://localhost:8787`（wrangler 本地 KV 模拟）
- 前端：`http://localhost:3000`

开发模式下前端会自动把 `/api/*` 指向 `http://localhost:8787`，无需额外配置。

也可以分开跑（两个终端）：

```bash
npm run cf:dev    # 终端 1：API
npm run dev       # 终端 2：前端
```

打开 http://localhost:3000 ，注册第一个账号即为管理员。

## 部署到 Cloudflare

1. 创建 KV 命名空间并记下 id：
   ```bash
   npx wrangler kv namespace create DNSHE_KV
   npx wrangler kv namespace create DNSHE_KV --preview
   ```
2. 把 id 填入 `cf-worker/wrangler.toml`。
3. 设置密钥：
   ```bash
   npx wrangler secret put JWT_SECRET --config cf-worker/wrangler.toml
   npx wrangler secret put ENCRYPTION_KEY --config cf-worker/wrangler.toml
   # 可选
   npx wrangler secret put INITIAL_ADMIN_USERNAME --config cf-worker/wrangler.toml
   npx wrangler secret put INITIAL_ADMIN_PASSWORD --config cf-worker/wrangler.toml
   ```
4. 部署 Worker：
   ```bash
   npm run cf:deploy
   ```
5. 前端部署到 Pages：构建命令 `npm run build`，输出目录 `out`。
6. 让 Pages 域名的 `/api/*` 路由到 Worker（Workers Routes），实现同源免 CORS。

## 部署到 EdgeOne

1. 在 EdgeOne 控制台创建 KV 命名空间，并绑定到项目，**运行时变量名设为 `DNSHE_KV`**。
2. 配置环境变量：`JWT_SECRET`、`ENCRYPTION_KEY`、`CRON_TOKEN`（与 `edgeone.json` 中 payload 一致）。
3. 推送代码，EdgeOne 按 `edgeone.json` 构建：`npm run build` → `out/`，同时部署 `edge-functions/`。
4. 定时同步走 `edgeone.json` 的 `schedules`（最小间隔 1 天），6 小时新鲜度由惰性同步补足。

## API 端点

```
POST   /api/auth                 登录 / 注册 / 登出（action 区分）
GET    /api/auth/me              当前用户
POST   /api/cron                 定时同步（需 CRON_TOKEN）
GET    /api/bootstrap            一次性返回 用户+账户+域名+租借+统计
GET    /api/accounts             账户列表（管理员）
POST   /api/accounts             添加账户（管理员，自动测试连接）
DELETE /api/accounts/:id         删除账户（管理员）
POST   /api/sync                 同步全部账户（管理员）
GET    /api/domains              域名列表（按权限过滤）
GET    /api/domains/:id          域名详情
POST   /api/domains/register     注册子域名（管理员，实时）
POST   /api/domains/:id/renew    续期（实时）
DELETE /api/domains/:id          删除域名（管理员，实时）
PATCH  /api/domains/:id          开关自助租借（管理员）
GET    /api/domains/:id/dns      DNS 记录（?refresh=1 实时刷新）
POST   /api/dns                  新建记录（实时）
PATCH  /api/dns/:id              修改记录（实时）
DELETE /api/dns/:id              删除记录（实时）
GET    /api/rentals              租借列表
POST   /api/rentals              创建租借（管理员）
POST   /api/rentals/claim        自助申请子域名（登录用户）
PATCH  /api/rentals/:id          续租 / 回收（管理员）
DELETE /api/rentals/:id          删除租借（管理员）
GET    /api/admin/users          用户列表（管理员）
POST   /api/admin/users          手动创建用户（管理员）
PATCH  /api/admin/users/:id      修改角色（管理员）
DELETE /api/admin/users/:id      删除用户（管理员）
GET    /api/admin/audit          审计日志（管理员）
```

## 注意

- Cloudflare KV 免费版写入 **1000 次/天**、list **1000 次/天**，本项目用索引文档减少 list 调用。
- 两端 KV 均为最终一致（边缘缓存最长 60 秒）。
- 登录令牌存于 `localStorage`，如需更强安全性可改为 httpOnly Cookie。
- EdgeOne Edge Functions CPU 限制 200ms/次（不含 I/O 等待）。

## 辅助脚本

`scripts/dnshe-delete-ns.sh`：批量删除所有域名的 NS 记录（例如域名委派给外部 DNS 导致无法管理时）。

```bash
# dry-run，只列出将被删除的 NS
DNSHE_API_KEY=xxx DNSHE_API_SECRET=yyy ./scripts/dnshe-delete-ns.sh

# 真正删除
DNSHE_API_KEY=xxx DNSHE_API_SECRET=yyy CONFIRM=yes ./scripts/dnshe-delete-ns.sh

# 只处理单个域名 / 调整间隔
ONLY=xf0.cc.cd SLEEP=3 CONFIRM=yes ... ./scripts/dnshe-delete-ns.sh
```

> 注意：删除 NS 会移除对外部 DNS 服务商的委派，域名将改由 DNSHE 平台解析。

## 常见问题

- **页面没样式 / CSS 404**：通常是 `next build` 和 `next dev` 共用 `.next` 目录导致。
  执行 `npm run dev:clean`（会先删 `.next`）或手动 `rm -rf .next` 后重启。
- **`NetworkError when attempting to fetch resource`**：API 没启动。用 `npm run dev:all`
  同时启动前端和 Worker，或另开终端 `npm run cf:dev`。
- **`npm run dev` 后 `/api/*` 返回 404**：同上，前端是静态的，`/api/*` 由独立的 Worker 提供。
- **注册提示用户名已存在**：服务端配置了 `INITIAL_ADMIN_USERNAME`，该账号已被自动创建；
  直接用它登录，或注释掉该配置并清空 `cf-worker/.wrangler/state` 后重启。

## License

MIT
