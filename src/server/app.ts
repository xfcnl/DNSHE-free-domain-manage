import { Hono } from "hono";
import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import { createCtx, type Ctx } from "./context";
import type { Store } from "./storage/store";
import type { DnsheAccount, Domain, Env, Rental, User } from "./types";
import { newId } from "./storage/repos";
import { encryptSecret, signJwt, verifyJwt } from "./lib/crypto";
import {
  authenticate,
  countUsers,
  createUser,
  ensureSeedAdmin,
  findUserByUsername,
  publicUser,
} from "./services/auth";
import { logAudit } from "./services/audit";
import { DnsheClient, normalizeStatus, normalizeDnsheError } from "./services/dnshe";
import {
  clientForAccount,
  maybeLazySync,
  refreshDnsCache,
  syncAccount,
  syncAll,
  upsertDomain,
} from "./services/sync";

export interface AppOptions {
  waitUntil?: (p: Promise<unknown>) => void;
}

type AppEnv = { Variables: { user: User } };

const TOKEN_TTL = 7 * 24 * 3600;

export function createApp(store: Store, env: Env, opts?: AppOptions) {
  const ctx = createCtx(store, env, opts?.waitUntil);
  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      origin: (origin) => origin ?? "*",
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    })
  );

  // ---------- 鉴权中间件 ----------
  const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!env.JWT_SECRET) return c.json({ error: "服务端未配置 JWT_SECRET" }, 500);
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const payload = token ? await verifyJwt(token, env.JWT_SECRET) : null;
    if (!payload) return c.json({ error: "未登录或登录已过期" }, 401);
    const user = await ctx.users.get(payload.sub);
    if (!user) return c.json({ error: "用户不存在" }, 401);
    c.set("user", user);
    await next();
  };

  const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
    const user = c.get("user");
    if (user?.role !== "admin") return c.json({ error: "需要管理员权限" }, 403);
    await next();
  };

  const issueToken = (user: User) => {
    const now = Math.floor(Date.now() / 1000);
    return signJwt(
      { sub: user.id, role: user.role, iat: now, exp: now + TOKEN_TTL },
      env.JWT_SECRET
    );
  };

  // ---------- 公开路由 ----------
  app.get("/", (c) =>
    c.json({
      name: "DNSHE 域名管理 API",
      hint: "这是 API 服务，不是网页。本地开发请访问前端 http://localhost:3000",
      health: "/api/health",
    })
  );

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post("/api/auth", async (c) => {
    if (!env.JWT_SECRET) return c.json({ error: "服务端未配置 JWT_SECRET" }, 500);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const action = body.action || c.req.query("action") || "login";
    await ensureSeedAdmin(ctx);

    if (action === "logout") return c.json({ ok: true });

    if (action === "register") {
      const username = String(body.username ?? "").trim();
      const password = String(body.password ?? "");
      if (!username || password.length < 6) {
        return c.json({ error: "用户名必填，密码至少 6 位" }, 400);
      }
      if (await findUserByUsername(ctx, username)) {
        return c.json({ error: "用户名已存在" }, 409);
      }
      const role = (await countUsers(ctx)) === 0 ? "admin" : "user";
      const user = await createUser(ctx, username, password, role);
      await logAudit(ctx, user.id, "register", user.username, `role=${role}`);
      return c.json({ token: await issueToken(user), user: publicUser(user) });
    }

    const user = await authenticate(ctx, String(body.username ?? ""), String(body.password ?? ""));
    if (!user) return c.json({ error: "用户名或密码错误" }, 401);
    return c.json({ token: await issueToken(user), user: publicUser(user) });
  });

  app.get("/api/auth/me", requireAuth, (c) => {
    return c.json({ user: publicUser(c.get("user") as User) });
  });

  // 供 EdgeOne schedules 等外部定时器调用（需 token）
  app.post("/api/cron", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const token = body.token || c.req.header("X-Cron-Token");
    if (!env.CRON_TOKEN || token !== env.CRON_TOKEN) {
      return c.json({ error: "无效的定时任务令牌" }, 403);
    }
    const results = await syncAll(ctx);
    return c.json({ results });
  });

  // ---------- 受保护路由 ----------
  const api = new Hono<AppEnv>();
  api.use("*", requireAuth);

  api.get("/bootstrap", async (c) => {
    const user = c.get("user") as User;
    const [accounts, rentals, allUsers, domains] = await Promise.all([
      ctx.accounts.all(),
      ctx.rentals.all(),
      ctx.users.all(),
      ctx.domains.all(),
    ]);
    const now = Date.now();
    const userMap = new Map(allUsers.map((u) => [u.id, u.username]));
    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    const activeRentals = rentals.filter((r) => isActiveRental(r, now));
    const entries = await buildDomainEntries(ctx, user);

    const syncing = await maybeLazySync(ctx);

    const stats = {
      domains: entries.length,
      active: entries.filter((d) => d.status === "active").length,
      expiringSoon: entries.filter((d) => {
        if (d.never_expires || !d.expires_at) return false;
        const t = Date.parse(d.expires_at);
        return t > now && t - now < 30 * 24 * 3600 * 1000;
      }).length,
      accounts: user.role === "admin" ? accounts.length : 0,
      users: user.role === "admin" ? allUsers.length : 0,
      rentals:
        user.role === "admin"
          ? activeRentals.length
          : activeRentals.filter((r) => r.renter_user_id === user.id).length,
    };

    // 开放自助申请的域名及其已占用前缀
    const selfService = domains
      .filter((d) => d.self_service)
      .map((d) => ({
        id: d.id,
        full_domain: d.full_domain,
        account_label: accountMap.get(d.account_id)?.label ?? null,
        taken_prefixes: activeRentals
          .filter((r) => r.domain_id === d.id && (r.prefix ?? ""))
          .map((r) => r.prefix),
      }));

    return c.json({
      user: publicUser(user),
      accounts: user.role === "admin" ? accounts.map(maskAccount) : [],
      domains: entries,
      rentals:
        user.role === "admin"
          ? rentals.map((r) => serializeRental(r, userMap))
          : rentals.filter((r) => r.renter_user_id === user.id).map((r) => serializeRental(r, userMap)),
      self_service: selfService,
      stats,
      syncing,
    });
  });

  // ---------- DNSHE 账户 ----------
  api.get("/accounts", requireAdmin, async (c) => {
    const accounts = await ctx.accounts.all();
    return c.json({ accounts: accounts.map(maskAccount) });
  });

  api.post("/accounts", requireAdmin, async (c) => {
    const user = c.get("user") as User;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const label = String(body.label ?? "").trim();
    const apiKey = String(body.api_key ?? "").trim();
    const apiSecret = String(body.api_secret ?? "").trim();
    if (!apiKey || !apiSecret) return c.json({ error: "api_key 和 api_secret 必填" }, 400);
    if (!env.ENCRYPTION_KEY) return c.json({ error: "服务端未配置 ENCRYPTION_KEY" }, 500);

    // 测试连接
    const testClient = new DnsheClient({ apiKey, apiSecret, base: env.DNSHE_API_BASE });
    const quota = await testClient.quota();
    if (!quota.success) return c.json({ error: `连接失败: ${quota.error}` }, 400);

    const account: DnsheAccount = {
      id: newId(),
      label: label || apiKey.slice(0, 12),
      api_key: apiKey,
      api_secret_enc: await encryptSecret(apiSecret, env.ENCRYPTION_KEY),
      last_synced_at: null,
      created_at: ctx.now(),
    };
    await ctx.accounts.insert(account);
    await logAudit(ctx, user.id, "account.create", account.label, account.id);
    const result = await syncAccount(ctx, account);
    return c.json({ account: maskAccount(account), quota: quota.quota, sync: result });
  });

  api.delete("/accounts/:id", requireAdmin, async (c) => {
    const user = c.get("user") as User;
    const id = c.req.param("id");
    const account = await ctx.accounts.get(id);
    if (!account) return c.json({ error: "账户不存在" }, 404);

    const domains = (await ctx.domains.all()).filter((d) => d.account_id === id);
    const domainIds = new Set(domains.map((d) => d.id));
    for (const d of domains) await ctx.domains.remove(d.id);
    for (const r of (await ctx.dnsRecords.all()).filter((r) => domainIds.has(r.domain_id))) {
      await ctx.dnsRecords.remove(r.id);
    }
    for (const r of (await ctx.rentals.all()).filter((r) => domainIds.has(r.domain_id))) {
      await ctx.rentals.remove(r.id);
    }
    await ctx.accounts.remove(id);
    await logAudit(ctx, user.id, "account.delete", account.label, id);
    return c.json({ ok: true });
  });

  api.post("/sync", requireAdmin, async (c) => {
    const user = c.get("user") as User;
    const results = await syncAll(ctx);
    await logAudit(ctx, user.id, "sync", "all", JSON.stringify(results.map((r) => ({ a: r.label, ok: r.ok, n: r.count }))));
    return c.json({ results });
  });

  // ---------- 域名 ----------
  api.get("/domains", async (c) => {
    const user = c.get("user") as User;
    const entries = await buildDomainEntries(ctx, user);
    return c.json({ domains: entries });
  });

  api.get("/domains/:id", async (c) => {
    const user = c.get("user") as User;
    const domain = await ctx.domains.get(c.req.param("id"));
    if (!domain) return c.json({ error: "域名不存在" }, 404);
    const scope = await resolveScope(ctx, user, domain, c.req.query("prefix"));
    if (!scope.ok) return c.json({ error: "无权访问该域名" }, 403);
    const all = (await ctx.dnsRecords.all()).filter((r) => r.domain_id === domain.id);
    const records = scope.admin
      ? all
      : all.filter((r) => recordInScope(r.name, domain.full_domain, scope.prefix));
    const account = await ctx.accounts.get(domain.account_id);
    return c.json({
      domain: {
        ...domain,
        scoped_domain: scope.prefix ? `${scope.prefix}.${domain.full_domain}` : domain.full_domain,
        rental_prefix: scope.prefix,
      },
      account: account ? maskAccount(account) : null,
      dns_records: records,
      scope: { admin: scope.admin, prefix: scope.prefix },
    });
  });

  api.post("/domains/register", requireAdmin, async (c) => {
    const user = c.get("user") as User;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const account = await ctx.accounts.get(String(body.account_id ?? ""));
    if (!account) return c.json({ error: "账户不存在" }, 400);
    const subdomain = String(body.subdomain ?? "").trim();
    const rootdomain = String(body.rootdomain ?? "").trim();
    if (!subdomain || !rootdomain) return c.json({ error: "subdomain 和 rootdomain 必填" }, 400);

    const client = await clientForAccount(ctx, account);
    const res = await client.registerSubdomain(subdomain, rootdomain);
    if (!res.success) return c.json(normalizeDnsheError(res.error, res.errorCode), 400);

    const detail = await client.getSubdomain(res.subdomain_id);
    if (detail.success && detail.subdomain) {
      await upsertDomain(ctx, account.id, detail.subdomain);
    }
    await logAudit(ctx, user.id, "domain.register", res.full_domain ?? subdomain, account.label);
    return c.json({ ok: true, subdomain_id: res.subdomain_id, full_domain: res.full_domain });
  });

  api.post("/domains/:id/renew", async (c) => {
    const user = c.get("user") as User;
    const domain = await ctx.domains.get(c.req.param("id"));
    if (!domain) return c.json({ error: "域名不存在" }, 404);
    if (!(await canAccessDomain(ctx, user, domain.id))) return c.json({ error: "无权操作该域名" }, 403);
    const account = await ctx.accounts.get(domain.account_id);
    if (!account) return c.json({ error: "账户不存在" }, 400);

    const client = await clientForAccount(ctx, account);
    const res = await client.renewSubdomain(domain.dnshe_subdomain_id);
    if (!res.success) return c.json(normalizeDnsheError(res.error, res.errorCode), 400);
    await ctx.domains.update(domain.id, {
      expires_at: res.new_expires_at ?? domain.expires_at,
      status: normalizeStatus(res.status ?? domain.status),
      updated_at: ctx.now(),
    });
    await logAudit(ctx, user.id, "domain.renew", domain.full_domain, `charged=${res.charged_amount ?? 0}`);
    return c.json({ ok: true, message: res.message, new_expires_at: res.new_expires_at });
  });

  api.delete("/domains/:id", requireAdmin, async (c) => {
    const user = c.get("user") as User;
    const domain = await ctx.domains.get(c.req.param("id"));
    if (!domain) return c.json({ error: "域名不存在" }, 404);
    const account = await ctx.accounts.get(domain.account_id);
    if (!account) return c.json({ error: "账户不存在" }, 400);

    const client = await clientForAccount(ctx, account);
    const res = await client.deleteSubdomain(domain.dnshe_subdomain_id);
    if (!res.success) return c.json(normalizeDnsheError(res.error, res.errorCode), 400);

    for (const r of (await ctx.dnsRecords.all()).filter((r) => r.domain_id === domain.id)) {
      await ctx.dnsRecords.remove(r.id);
    }
    for (const r of (await ctx.rentals.all()).filter((r) => r.domain_id === domain.id)) {
      await ctx.rentals.remove(r.id);
    }
    await ctx.domains.remove(domain.id);
    await logAudit(ctx, user.id, "domain.delete", domain.full_domain, account.label);
    return c.json({ ok: true });
  });

  api.patch("/domains/:id", requireAdmin, async (c) => {
    const user = c.get("user") as User;
    const domain = await ctx.domains.get(c.req.param("id"));
    if (!domain) return c.json({ error: "域名不存在" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const patch: Partial<Domain> = {};
    if (body.self_service !== undefined) patch.self_service = !!body.self_service;
    const updated = await ctx.domains.update(domain.id, patch);
    await logAudit(ctx, user.id, "domain.update", domain.full_domain, JSON.stringify(patch));
    return c.json({ domain: updated });
  });

  // ---------- DNS 记录 ----------
  api.get("/domains/:id/dns", async (c) => {
    const user = c.get("user") as User;
    const domain = await ctx.domains.get(c.req.param("id"));
    if (!domain) return c.json({ error: "域名不存在" }, 404);
    const scope = await resolveScope(ctx, user, domain, c.req.query("prefix"));
    if (!scope.ok) return c.json({ error: "无权访问该域名" }, 403);
    if (c.req.query("refresh") === "1") {
      const r = await refreshDnsCache(ctx, domain);
      if (!r.ok) return c.json(normalizeDnsheError(r.error), 400);
    }
    const all = (await ctx.dnsRecords.all()).filter((r) => r.domain_id === domain.id);
    const records = scope.admin
      ? all
      : all.filter((r) => recordInScope(r.name, domain.full_domain, scope.prefix));
    return c.json({ records });
  });

  api.post("/dns", async (c) => {
    const user = c.get("user") as User;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const domain = await ctx.domains.get(String(body.domain_id ?? ""));
    if (!domain) return c.json({ error: "域名不存在" }, 404);
    const scope = await resolveScope(ctx, user, domain, body.prefix);
    if (!scope.ok) return c.json({ error: "无权操作该域名" }, 403);
    const account = await ctx.accounts.get(domain.account_id);
    if (!account) return c.json({ error: "账户不存在" }, 400);

    const entered = String(body.name ?? "").trim();
    const relative = scope.admin
      ? toRelativeName(entered, domain.full_domain)
      : scopedRelativeName(entered, domain.full_domain, scope.prefix);
    if (!scope.admin) {
      const full = relativeToFull(relative, domain.full_domain);
      if (!recordInScope(full, domain.full_domain, scope.prefix)) {
        return c.json({ error: `记录名必须位于 ${scope.prefix}.${domain.full_domain} 之内` }, 403);
      }
    }

    const payload: Record<string, unknown> = {
      subdomain_id: domain.dnshe_subdomain_id,
      type: body.type,
      content: body.content,
      ttl: body.ttl ?? 600,
      name: relative,
    };
    if (body.priority != null) payload.priority = body.priority;
    if (body.line) payload.line = body.line;
    if (body.proxied != null) payload.proxied = body.proxied;

    const client = await clientForAccount(ctx, account);
    const res = await client.createDnsRecord(payload);
    if (!res.success) return c.json(normalizeDnsheError(res.error, res.errorCode), 400);
    await refreshDnsCache(ctx, domain);
    await logAudit(ctx, user.id, "dns.create", domain.full_domain, `${body.type} ${relative}`);
    return c.json({ ok: true, id: res.id, record_id: res.record_id });
  });

  api.patch("/dns/:id", async (c) => {
    const user = c.get("user") as User;
    const record = await ctx.dnsRecords.get(c.req.param("id"));
    if (!record) return c.json({ error: "记录不存在" }, 404);
    const domain = await ctx.domains.get(record.domain_id);
    if (!domain) return c.json({ error: "域名不存在" }, 404);
    const covering = await findCoveringRental(ctx, user, domain, record.name);
    if (user.role !== "admin" && !covering) return c.json({ error: "无权操作该记录" }, 403);
    const account = await ctx.accounts.get(domain.account_id);
    if (!account) return c.json({ error: "账户不存在" }, 400);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    if (body.name !== undefined) {
      const entered = String(body.name);
      const relative =
        user.role === "admin" || !covering
          ? toRelativeName(entered, domain.full_domain)
          : scopedRelativeName(entered, domain.full_domain, covering.prefix ?? "");
      if (user.role !== "admin" && covering) {
        const full = relativeToFull(relative, domain.full_domain);
        if (!recordInScope(full, domain.full_domain, covering.prefix ?? "")) {
          return c.json({ error: "记录名超出你的租借范围" }, 403);
        }
      }
      body.name = relative;
    }

    const payload: Record<string, unknown> = { ...recordLocator(record.dnshe_record_id) };
    for (const k of ["type", "name", "content", "ttl", "priority", "line", "proxied"]) {
      if (body[k] !== undefined) payload[k] = body[k];
    }

    const client = await clientForAccount(ctx, account);
    const res = await client.updateDnsRecord(payload);
    if (!res.success) return c.json(normalizeDnsheError(res.error, res.errorCode), 400);
    await refreshDnsCache(ctx, domain);
    await logAudit(ctx, user.id, "dns.update", domain.full_domain, record.name);
    return c.json({ ok: true });
  });

  api.delete("/dns/:id", async (c) => {
    const user = c.get("user") as User;
    const record = await ctx.dnsRecords.get(c.req.param("id"));
    if (!record) return c.json({ error: "记录不存在" }, 404);
    const domain = await ctx.domains.get(record.domain_id);
    if (!domain) return c.json({ error: "域名不存在" }, 404);
    const covering = await findCoveringRental(ctx, user, domain, record.name);
    if (user.role !== "admin" && !covering) return c.json({ error: "无权操作该记录" }, 403);
    const account = await ctx.accounts.get(domain.account_id);
    if (!account) return c.json({ error: "账户不存在" }, 400);

    const client = await clientForAccount(ctx, account);
    const res = await client.deleteDnsRecord(recordLocator(record.dnshe_record_id));
    if (!res.success) return c.json(normalizeDnsheError(res.error, res.errorCode), 400);
    await refreshDnsCache(ctx, domain);
    await logAudit(ctx, user.id, "dns.delete", domain.full_domain, `${record.type} ${record.name}`);
    return c.json({ ok: true });
  });

  // ---------- 租借 ----------
  api.get("/rentals", async (c) => {
    const user = c.get("user") as User;
    const [rentals, users] = await Promise.all([ctx.rentals.all(), ctx.users.all()]);
    const userMap = new Map(users.map((u) => [u.id, u.username]));
    const visible = user.role === "admin" ? rentals : rentals.filter((r) => r.renter_user_id === user.id);
    return c.json({ rentals: visible.map((r) => serializeRental(r, userMap)) });
  });

  api.post("/rentals", requireAdmin, async (c) => {
    const user = c.get("user") as User;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const domain = await ctx.domains.get(String(body.domain_id ?? ""));
    if (!domain) return c.json({ error: "域名不存在" }, 404);

    const prefix = sanitizePrefix(body.prefix);
    if (prefix === null) return c.json({ error: "子域名前缀非法（只能包含字母、数字、连字符和点）" }, 400);

    let renter: User | null = null;
    if (body.renter_user_id) renter = await ctx.users.get(String(body.renter_user_id));
    else if (body.renter) renter = await findUserByUsername(ctx, String(body.renter));
    if (!renter) return c.json({ error: "目标用户不存在" }, 400);

    const active = (await ctx.rentals.all()).filter(
      (r) => r.domain_id === domain.id && isActiveRental(r)
    );
    const conflict = active.find((r) => prefixesConflict(r.prefix ?? "", prefix));
    if (conflict) {
      const scopeLabel = conflict.prefix ? `${conflict.prefix}.${domain.full_domain}` : domain.full_domain;
      return c.json({ error: `租借范围与已有租借冲突：${scopeLabel}` }, 409);
    }

    const rental: Rental = {
      id: newId(),
      domain_id: domain.id,
      renter_user_id: renter.id,
      rented_by: user.id,
      rented_at: ctx.now(),
      expires_at: body.expires_at ? new Date(body.expires_at).toISOString() : null,
      status: "active",
      prefix,
      notes: String(body.notes ?? ""),
    };
    await ctx.rentals.insert(rental);
    const scopeLabel = prefix ? `${prefix}.${domain.full_domain}` : domain.full_domain;
    await logAudit(ctx, user.id, "rental.create", scopeLabel, `→ ${renter.username}`);
    return c.json({ rental: serializeRental(rental, new Map([[renter.id, renter.username]])) });
  });

  // 普通用户自助申请子域名（域名需由管理员开启 self_service）
  api.post("/rentals/claim", async (c) => {
    const user = c.get("user") as User;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const domain = await ctx.domains.get(String(body.domain_id ?? ""));
    if (!domain) return c.json({ error: "域名不存在" }, 404);
    if (!domain.self_service) return c.json({ error: "该域名未开放自助申请" }, 403);

    const prefix = sanitizePrefix(body.prefix);
    if (!prefix) {
      return c.json({ error: "请填写子域名前缀（只能包含字母、数字、连字符和点）" }, 400);
    }

    const active = (await ctx.rentals.all()).filter(
      (r) => r.domain_id === domain.id && isActiveRental(r)
    );
    const conflict = active.find((r) => prefixesConflict(r.prefix ?? "", prefix));
    if (conflict) {
      const label = conflict.prefix ? `${conflict.prefix}.${domain.full_domain}` : domain.full_domain;
      return c.json({ error: `该子域名已被占用：${label}` }, 409);
    }

    const rental: Rental = {
      id: newId(),
      domain_id: domain.id,
      renter_user_id: user.id,
      rented_by: user.id,
      rented_at: ctx.now(),
      expires_at: null,
      status: "active",
      prefix,
      notes: "自助申请",
    };
    await ctx.rentals.insert(rental);
    const label = `${prefix}.${domain.full_domain}`;
    await logAudit(ctx, user.id, "rental.claim", label, user.username);
    return c.json({ rental: serializeRental(rental, new Map([[user.id, user.username]])) });
  });

  api.patch("/rentals/:id", requireAdmin, async (c) => {
    const user = c.get("user") as User;
    const rental = await ctx.rentals.get(c.req.param("id"));
    if (!rental) return c.json({ error: "租借不存在" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const patch: Partial<Rental> = {};
    if (body.status) patch.status = body.status;
    if (body.expires_at !== undefined) {
      patch.expires_at = body.expires_at ? new Date(body.expires_at).toISOString() : null;
    }
    if (body.notes !== undefined) patch.notes = String(body.notes);
    if (body.prefix !== undefined) {
      const prefix = sanitizePrefix(body.prefix);
      if (prefix === null) return c.json({ error: "子域名前缀非法" }, 400);
      const others = (await ctx.rentals.all()).filter(
        (r) => r.id !== rental.id && r.domain_id === rental.domain_id && isActiveRental(r)
      );
      if (others.some((r) => prefixesConflict(r.prefix ?? "", prefix))) {
        return c.json({ error: "租借范围与已有租借冲突" }, 409);
      }
      patch.prefix = prefix;
    }
    const updated = await ctx.rentals.update(rental.id, patch);
    await logAudit(ctx, user.id, "rental.update", rental.id, JSON.stringify(patch));
    return c.json({ rental: updated });
  });

  api.delete("/rentals/:id", requireAdmin, async (c) => {
    const user = c.get("user") as User;
    const rental = await ctx.rentals.get(c.req.param("id"));
    if (!rental) return c.json({ error: "租借不存在" }, 404);
    await ctx.rentals.remove(rental.id);
    await logAudit(ctx, user.id, "rental.delete", rental.id, "");
    return c.json({ ok: true });
  });

  // ---------- 管理后台 ----------
  api.get("/admin/users", requireAdmin, async (c) => {
    const users = await ctx.users.all();
    return c.json({ users: users.map(publicUser) });
  });

  api.post("/admin/users", requireAdmin, async (c) => {
    const me = c.get("user") as User;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    const role = body.role === "admin" ? "admin" : "user";
    if (!username) return c.json({ error: "用户名必填" }, 400);
    if (password.length < 6) return c.json({ error: "密码至少 6 位" }, 400);
    if (await findUserByUsername(ctx, username)) return c.json({ error: "用户名已存在" }, 409);
    const user = await createUser(ctx, username, password, role);
    await logAudit(ctx, me.id, "user.create", user.username, `role=${role}`);
    return c.json({ user: publicUser(user) });
  });

  api.patch("/admin/users/:id", requireAdmin, async (c) => {
    const me = c.get("user") as User;
    const target = await ctx.users.get(c.req.param("id"));
    if (!target) return c.json({ error: "用户不存在" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    if (body.role !== "admin" && body.role !== "user") return c.json({ error: "角色非法" }, 400);
    if (target.id === me.id) return c.json({ error: "不能修改自己的角色" }, 400);
    const updated = await ctx.users.update(target.id, { role: body.role });
    await logAudit(ctx, me.id, "user.role", target.username, body.role);
    return c.json({ user: updated ? publicUser(updated) : null });
  });

  api.delete("/admin/users/:id", requireAdmin, async (c) => {
    const me = c.get("user") as User;
    const target = await ctx.users.get(c.req.param("id"));
    if (!target) return c.json({ error: "用户不存在" }, 404);
    if (target.id === me.id) return c.json({ error: "不能删除自己" }, 400);
    await ctx.users.remove(target.id);
    for (const r of (await ctx.rentals.all()).filter((r) => r.renter_user_id === target.id)) {
      await ctx.rentals.update(r.id, { status: "revoked" });
    }
    await logAudit(ctx, me.id, "user.delete", target.username, "");
    return c.json({ ok: true });
  });

  api.get("/admin/audit", requireAdmin, async (c) => {
    const logs = await ctx.auditLogs.all();
    logs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return c.json({ logs: logs.slice(0, 200) });
  });

  app.route("/api", api);
  return app;
}

// ---------- 辅助函数 ----------

function maskAccount(a: DnsheAccount) {
  const key = a.api_key ?? "";
  return {
    id: a.id,
    label: a.label,
    api_key: key.length > 12 ? `${key.slice(0, 8)}...${key.slice(-4)}` : key,
    last_synced_at: a.last_synced_at,
    created_at: a.created_at,
  };
}

function isActiveRental(r: Rental, now = Date.now()): boolean {
  return r.status === "active" && (!r.expires_at || Date.parse(r.expires_at) > now);
}

/** 把 DNS 记录名归一化成完整域名 */
function fullRecordName(name: string | null | undefined, domainFull: string): string {
  const n = (name ?? "").trim();
  if (!n || n === "@") return domainFull;
  if (n === domainFull || n.endsWith("." + domainFull)) return n;
  return `${n}.${domainFull}`;
}

/** 记录是否位于某个子域名前缀作用域内（含其下级） */
function recordInScope(name: string | null | undefined, domainFull: string, prefix: string): boolean {
  if (!prefix) return true;
  const scope = `${prefix}.${domainFull}`;
  const full = fullRecordName(name, domainFull);
  return full === scope || full.endsWith("." + scope);
}

/** 把记录名转成 DNSHE 需要的相对名（@ 或相对名，不接受完整域名） */
function toRelativeName(name: string | null | undefined, domainFull: string): string {
  const n = (name ?? "").trim();
  if (!n || n === "@") return "@";
  if (n === domainFull) return "@";
  if (n.endsWith("." + domainFull)) return n.slice(0, -(domainFull.length + 1));
  return n;
}

/** 作用域用户输入 → DNSHE 相对记录名 */
function scopedRelativeName(entered: string, domainFull: string, prefix: string): string {
  const n = (entered ?? "").trim();
  if (!prefix) return toRelativeName(n, domainFull);
  // 用户填了完整域名：转成相对名，是否越界交给后续作用域校验
  if (n === domainFull || n.endsWith("." + domainFull)) return toRelativeName(n, domainFull);
  if (!n || n === "@") return prefix;
  if (n === prefix || n.endsWith("." + prefix)) return n;
  return `${n}.${prefix}`;
}

/** 相对名 → 完整域名（用于作用域校验） */
function relativeToFull(rel: string, domainFull: string): string {
  return !rel || rel === "@" ? domainFull : `${rel}.${domainFull}`;
}

/** DNSHE 记录定位参数：优先内部数字 id（update 后仍稳定），否则 provider record_id */
function recordLocator(dnsheId: string | null | undefined): Record<string, unknown> {
  const v = dnsheId ?? "";
  if (/^\d+$/.test(v)) return { id: Number(v) };
  return { record_id: v };
}

/** 两个前缀是否冲突（空 = 整个域名；支持嵌套，如 11 与 11.a 冲突） */
function prefixesConflict(a: string, b: string): boolean {
  if (!a || !b) return true;
  if (a === b) return true;
  return a.startsWith(b + ".") || b.startsWith(a + ".");
}

/** 规范化并校验子域名前缀，返回 null 表示非法 */
function sanitizePrefix(input: unknown): string | null {
  const raw = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!raw) return "";
  if (raw.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(raw)) return null;
  return raw;
}

function serializeRental(r: Rental, userMap: Map<string, string>) {
  return {
    ...r,
    prefix: r.prefix ?? "",
    renter: userMap.get(r.renter_user_id) ?? r.renter_user_id,
    rented_by_name: userMap.get(r.rented_by) ?? r.rented_by,
  };
}

interface DomainEntryOptions {
  accountMap: Map<string, DnsheAccount>;
  userMap: Map<string, string>;
  activeRentals: Rental[];
}

function domainEntry(d: Domain, rental: Rental | undefined, opts: DomainEntryOptions) {
  const prefix = rental?.prefix ?? "";
  const activeForDomain = opts.activeRentals.filter((r) => r.domain_id === d.id);
  return {
    id: d.id,
    account_id: d.account_id,
    account_label: opts.accountMap.get(d.account_id)?.label ?? null,
    dnshe_subdomain_id: d.dnshe_subdomain_id,
    subdomain: d.subdomain,
    rootdomain: d.rootdomain,
    full_domain: d.full_domain,
    scoped_domain: prefix ? `${prefix}.${d.full_domain}` : d.full_domain,
    status: d.status,
    expires_at: d.expires_at,
    never_expires: d.never_expires,
    self_service: d.self_service ?? false,
    rental_id: rental?.id ?? null,
    rental_prefix: prefix,
    renter: rental ? opts.userMap.get(rental.renter_user_id) ?? rental.renter_user_id : null,
    rental_expires_at: rental?.expires_at ?? null,
    rentals: activeForDomain.map((r) => ({
      id: r.id,
      renter: opts.userMap.get(r.renter_user_id) ?? r.renter_user_id,
      prefix: r.prefix ?? "",
      scoped_domain: r.prefix ? `${r.prefix}.${d.full_domain}` : d.full_domain,
      expires_at: r.expires_at,
    })),
  };
}

type DomainEntry = ReturnType<typeof domainEntry>;

/** 构建当前用户可见的域名条目（管理员：每域名一条并带租借汇总；普通用户：每条租借一条） */
async function buildDomainEntries(ctx: Ctx, user: User): Promise<DomainEntry[]> {
  const [domains, accounts, rentals, users] = await Promise.all([
    ctx.domains.all(),
    ctx.accounts.all(),
    ctx.rentals.all(),
    ctx.users.all(),
  ]);
  const now = Date.now();
  const opts: DomainEntryOptions = {
    accountMap: new Map(accounts.map((a) => [a.id, a])),
    userMap: new Map(users.map((u) => [u.id, u.username])),
    activeRentals: rentals.filter((r) => isActiveRental(r, now)),
  };

  if (user.role === "admin") {
    return domains.map((d) => domainEntry(d, undefined, opts));
  }
  const mine = opts.activeRentals.filter((r) => r.renter_user_id === user.id);
  const out: DomainEntry[] = [];
  for (const r of mine) {
    const d = domains.find((x) => x.id === r.domain_id);
    if (d) out.push(domainEntry(d, r, opts));
  }
  return out;
}

interface ScopeResult {
  ok: boolean;
  admin: boolean;
  rental: Rental | null;
  prefix: string;
}

/** 解析当前用户对某域名的操作作用域 */
async function resolveScope(ctx: Ctx, user: User, domain: Domain, prefixReq: unknown): Promise<ScopeResult> {
  if (user.role === "admin") {
    const prefix = prefixReq === undefined || prefixReq === null ? "" : sanitizePrefix(prefixReq) ?? "";
    return { ok: true, admin: true, rental: null, prefix };
  }
  const now = Date.now();
  const mine = (await ctx.rentals.all()).filter(
    (r) => r.domain_id === domain.id && r.renter_user_id === user.id && isActiveRental(r, now)
  );
  if (mine.length === 0) return { ok: false, admin: false, rental: null, prefix: "" };
  if (prefixReq !== undefined && prefixReq !== null && String(prefixReq) !== "") {
    const want = sanitizePrefix(prefixReq);
    const r = mine.find((x) => (x.prefix ?? "") === want);
    if (!r) return { ok: false, admin: false, rental: null, prefix: "" };
    return { ok: true, admin: false, rental: r, prefix: r.prefix ?? "" };
  }
  if (mine.length === 1) return { ok: true, admin: false, rental: mine[0], prefix: mine[0].prefix ?? "" };
  return { ok: false, admin: false, rental: null, prefix: "" };
}

/** 找到覆盖某条记录的用户租借（用于改/删记录） */
async function findCoveringRental(
  ctx: Ctx,
  user: User,
  domain: Domain,
  recordName: string | null
): Promise<Rental | null> {
  if (user.role === "admin") return null;
  const now = Date.now();
  const mine = (await ctx.rentals.all()).filter(
    (r) => r.domain_id === domain.id && r.renter_user_id === user.id && isActiveRental(r, now)
  );
  return mine.find((r) => recordInScope(recordName, domain.full_domain, r.prefix ?? "")) ?? null;
}

async function canAccessDomain(ctx: Ctx, user: User, domainId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  const now = Date.now();
  const rentals = (await ctx.rentals.all()).filter(
    (r) =>
      r.domain_id === domainId &&
      r.renter_user_id === user.id &&
      isActiveRental(r, now)
  );
  return rentals.length > 0;
}
