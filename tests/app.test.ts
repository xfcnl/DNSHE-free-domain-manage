import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/server/app";
import { MemoryStore, testEnv, createDnsheMock } from "./helpers";

type App = ReturnType<typeof createApp>;

async function call(
  app: App,
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await app.fetch(
    new Request(`http://test${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
  );
  const data = await res.json().catch(() => null);
  return { status: res.status, data: data as any };
}

let mock: ReturnType<typeof createDnsheMock>;
let uninstall: () => void;

beforeEach(() => {
  mock = createDnsheMock();
  uninstall = mock.install();
});

afterEach(() => {
  uninstall();
});

describe("API 集成", () => {
  it("health 正常", async () => {
    const app = createApp(new MemoryStore(), testEnv());
    const r = await call(app, "/api/health");
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
  });

  it("未登录访问受保护接口返回 401", async () => {
    const app = createApp(new MemoryStore(), testEnv());
    const r = await call(app, "/api/bootstrap");
    expect(r.status).toBe(401);
  });

  it("未配置 JWT_SECRET 时登录接口报错", async () => {
    const app = createApp(new MemoryStore(), testEnv({ JWT_SECRET: "" }));
    const r = await call(app, "/api/auth", {
      method: "POST",
      body: { action: "login", username: "a", password: "b" },
    });
    expect(r.status).toBe(500);
  });

  it("完整业务流程：账户→域名→DNS→租借→权限隔离", async () => {
    const app = createApp(new MemoryStore(), testEnv());

    // 1. 首个注册用户成为管理员
    const reg = await call(app, "/api/auth", {
      method: "POST",
      body: { action: "register", username: "admin", password: "secret123" },
    });
    expect(reg.status).toBe(200);
    expect(reg.data.user.role).toBe("admin");
    const admin = reg.data.token as string;

    // 2. 错误密码被拒
    const bad = await call(app, "/api/auth", {
      method: "POST",
      body: { action: "login", username: "admin", password: "nope" },
    });
    expect(bad.status).toBe(401);

    // 3. 添加 DNSHE 账户（走 mock）
    const acc = await call(app, "/api/accounts", {
      method: "POST",
      token: admin,
      body: { label: "主号", api_key: "cfsd_test", api_secret: "secret" },
    });
    expect(acc.status).toBe(200);
    expect(acc.data.account.label).toBe("主号");
    expect(acc.data.quota.available).toBe(5);
    const accountId = acc.data.account.id as string;

    // 4. 注册子域名
    const dreg = await call(app, "/api/domains/register", {
      method: "POST",
      token: admin,
      body: { account_id: accountId, subdomain: "app", rootdomain: "example.com" },
    });
    expect(dreg.status).toBe(200);
    expect(dreg.data.full_domain).toBe("app.example.com");

    // 5. 域名列表
    const domains = await call(app, "/api/domains", { token: admin });
    expect(domains.data.domains.length).toBe(1);
    const domainId = domains.data.domains[0].id as string;

    // 6. DNS 增删改查
    const dns0 = await call(app, `/api/domains/${domainId}/dns?refresh=1`, { token: admin });
    expect(dns0.data.records.length).toBe(0);

    const created = await call(app, "/api/dns", {
      method: "POST",
      token: admin,
      body: { domain_id: domainId, type: "A", content: "1.2.3.4", ttl: 600 },
    });
    expect(created.status).toBe(200);

    const dns1 = await call(app, `/api/domains/${domainId}/dns?refresh=1`, { token: admin });
    expect(dns1.data.records.length).toBe(1);
    const recId = dns1.data.records[0].id as string;

    const upd = await call(app, `/api/dns/${recId}`, {
      method: "PATCH",
      token: admin,
      body: { content: "5.6.7.8" },
    });
    expect(upd.status).toBe(200);
    const dns2 = await call(app, `/api/domains/${domainId}/dns?refresh=1`, { token: admin });
    expect(dns2.data.records[0].content).toBe("5.6.7.8");

    const del = await call(app, `/api/dns/${recId}`, { method: "DELETE", token: admin });
    expect(del.status).toBe(200);
    const dns3 = await call(app, `/api/domains/${domainId}/dns?refresh=1`, { token: admin });
    expect(dns3.data.records.length).toBe(0);

    // 7. 第二个用户注册为普通用户
    const reg2 = await call(app, "/api/auth", {
      method: "POST",
      body: { action: "register", username: "user2", password: "secret123" },
    });
    expect(reg2.data.user.role).toBe("user");
    const user2 = reg2.data.token as string;
    const user2Id = reg2.data.user.id as string;

    // 8. 普通用户看不到任何域名
    const beforeRent = await call(app, "/api/bootstrap", { token: user2 });
    expect(beforeRent.data.domains.length).toBe(0);

    // 9. 管理员租借
    const rent = await call(app, "/api/rentals", {
      method: "POST",
      token: admin,
      body: { domain_id: domainId, renter_user_id: user2Id },
    });
    expect(rent.status).toBe(200);

    // 10. 普通用户现在能看到，且带租借人
    const afterRent = await call(app, "/api/bootstrap", { token: user2 });
    expect(afterRent.data.domains.length).toBe(1);
    expect(afterRent.data.domains[0].renter).toBe("user2");

    // 11. 普通用户可以管理该域名的 DNS
    const u2dns = await call(app, "/api/dns", {
      method: "POST",
      token: user2,
      body: { domain_id: domainId, type: "TXT", content: "hello" },
    });
    expect(u2dns.status).toBe(200);

    // 12. 普通用户不能访问管理接口
    const forbidden = await call(app, "/api/admin/users", { token: user2 });
    expect(forbidden.status).toBe(403);

    // 13. 普通用户不能删除域名
    const delDomain = await call(app, `/api/domains/${domainId}`, { method: "DELETE", token: user2 });
    expect(delDomain.status).toBe(403);

    // 14. 回收租借后普通用户又看不到了
    const rentalId = rent.data.rental.id as string;
    await call(app, `/api/rentals/${rentalId}`, {
      method: "PATCH",
      token: admin,
      body: { status: "revoked" },
    });
    const afterRevoke = await call(app, "/api/bootstrap", { token: user2 });
    expect(afterRevoke.data.domains.length).toBe(0);

    // 15. 管理员统计
    const boot = await call(app, "/api/bootstrap", { token: admin });
    expect(boot.data.stats.domains).toBe(1);
    expect(boot.data.stats.users).toBe(2);
  });

  it("子域名（更深一层）租借与作用域隔离", async () => {
    const app = createApp(new MemoryStore(), testEnv());

    const reg = await call(app, "/api/auth", {
      method: "POST",
      body: { action: "register", username: "admin", password: "secret123" },
    });
    const admin = reg.data.token as string;

    const acc = await call(app, "/api/accounts", {
      method: "POST",
      token: admin,
      body: { label: "主号", api_key: "cfsd_test", api_secret: "secret" },
    });
    const accountId = acc.data.account.id as string;

    await call(app, "/api/domains/register", {
      method: "POST",
      token: admin,
      body: { account_id: accountId, subdomain: "app", rootdomain: "example.com" },
    });
    const domains = await call(app, "/api/domains", { token: admin });
    const domainId = domains.data.domains[0].id as string;

    const reg2 = await call(app, "/api/auth", {
      method: "POST",
      body: { action: "register", username: "user2", password: "secret123" },
    });
    const user2 = reg2.data.token as string;
    const user2Id = reg2.data.user.id as string;

    // 管理员把子域名 11 租给 user2
    const rent = await call(app, "/api/rentals", {
      method: "POST",
      token: admin,
      body: { domain_id: domainId, renter_user_id: user2Id, prefix: "11" },
    });
    expect(rent.status).toBe(200);
    expect(rent.data.rental.prefix).toBe("11");

    // user2 看到的作用域域名是 11.app.example.com
    const boot = await call(app, "/api/bootstrap", { token: user2 });
    expect(boot.data.domains.length).toBe(1);
    expect(boot.data.domains[0].scoped_domain).toBe("11.app.example.com");
    expect(boot.data.domains[0].rental_prefix).toBe("11");

    // 创建 @ 记录 → 落在 11.app.example.com
    const created = await call(app, "/api/dns", {
      method: "POST",
      token: user2,
      body: { domain_id: domainId, prefix: "11", type: "A", content: "9.9.9.9", name: "@" },
    });
    expect(created.status).toBe(200);

    const dns = await call(app, `/api/domains/${domainId}/dns?prefix=11`, { token: user2 });
    expect(dns.data.records.length).toBe(1);
    expect(dns.data.records[0].name).toBe("11.app.example.com");

    // 作用域内创建下级记录 www → www.11.app.example.com
    const created2 = await call(app, "/api/dns", {
      method: "POST",
      token: user2,
      body: { domain_id: domainId, prefix: "11", type: "A", content: "8.8.8.8", name: "www" },
    });
    expect(created2.status).toBe(200);

    // 作用域外的完整记录名被拒绝
    const evil = await call(app, "/api/dns", {
      method: "POST",
      token: user2,
      body: { domain_id: domainId, prefix: "11", type: "A", content: "6.6.6.6", name: "evil.app.example.com" },
    });
    expect(evil.status).toBe(403);

    // 冲突检测：相同前缀 / 整个域名 / 嵌套前缀
    const conflict1 = await call(app, "/api/rentals", {
      method: "POST",
      token: admin,
      body: { domain_id: domainId, renter_user_id: user2Id, prefix: "11" },
    });
    expect(conflict1.status).toBe(409);
    const conflict2 = await call(app, "/api/rentals", {
      method: "POST",
      token: admin,
      body: { domain_id: domainId, renter_user_id: user2Id, prefix: "" },
    });
    expect(conflict2.status).toBe(409);
    const conflict3 = await call(app, "/api/rentals", {
      method: "POST",
      token: admin,
      body: { domain_id: domainId, renter_user_id: user2Id, prefix: "11.a" },
    });
    expect(conflict3.status).toBe(409);
    // 不冲突的前缀可以租
    const okRent = await call(app, "/api/rentals", {
      method: "POST",
      token: admin,
      body: { domain_id: domainId, renter_user_id: user2Id, prefix: "12" },
    });
    expect(okRent.status).toBe(200);

    // 管理员不受作用域限制，能看到全部记录
    const adminDns = await call(app, `/api/domains/${domainId}/dns`, { token: admin });
    expect(adminDns.data.records.length).toBeGreaterThanOrEqual(2);
  });

  it("管理员可手动创建用户", async () => {
    const app = createApp(new MemoryStore(), testEnv());

    const reg = await call(app, "/api/auth", {
      method: "POST",
      body: { action: "register", username: "admin", password: "secret123" },
    });
    const admin = reg.data.token as string;

    const created = await call(app, "/api/admin/users", {
      method: "POST",
      token: admin,
      body: { username: "bob", password: "bobpass123", role: "user" },
    });
    expect(created.status).toBe(200);
    expect(created.data.user.username).toBe("bob");
    expect(created.data.user.role).toBe("user");

    // 新用户可直接登录
    const login = await call(app, "/api/auth", {
      method: "POST",
      body: { action: "login", username: "bob", password: "bobpass123" },
    });
    expect(login.status).toBe(200);
    const bob = login.data.token as string;

    // 重复用户名
    const dup = await call(app, "/api/admin/users", {
      method: "POST",
      token: admin,
      body: { username: "bob", password: "bobpass123", role: "user" },
    });
    expect(dup.status).toBe(409);

    // 弱密码
    const weak = await call(app, "/api/admin/users", {
      method: "POST",
      token: admin,
      body: { username: "weak", password: "123", role: "user" },
    });
    expect(weak.status).toBe(400);

    // 普通用户无权创建
    const forbidden = await call(app, "/api/admin/users", {
      method: "POST",
      token: bob,
      body: { username: "x", password: "xxxxxx", role: "user" },
    });
    expect(forbidden.status).toBe(403);
  });

  it("自助申请子域名：管理员开启后普通用户可自动租借", async () => {
    const app = createApp(new MemoryStore(), testEnv());

    const reg = await call(app, "/api/auth", {
      method: "POST",
      body: { action: "register", username: "admin", password: "secret123" },
    });
    const admin = reg.data.token as string;

    const acc = await call(app, "/api/accounts", {
      method: "POST",
      token: admin,
      body: { label: "主号", api_key: "cfsd_test", api_secret: "secret" },
    });
    const accountId = acc.data.account.id as string;

    await call(app, "/api/domains/register", {
      method: "POST",
      token: admin,
      body: { account_id: accountId, subdomain: "app", rootdomain: "example.com" },
    });
    const domains = await call(app, "/api/domains", { token: admin });
    const domainId = domains.data.domains[0].id as string;

    const reg2 = await call(app, "/api/auth", {
      method: "POST",
      body: { action: "register", username: "user2", password: "secret123" },
    });
    const user2 = reg2.data.token as string;

    // 未开启自助：申请被拒
    const denied = await call(app, "/api/rentals/claim", {
      method: "POST",
      token: user2,
      body: { domain_id: domainId, prefix: "11" },
    });
    expect(denied.status).toBe(403);

    // 管理员开启自助
    const toggle = await call(app, `/api/domains/${domainId}`, {
      method: "PATCH",
      token: admin,
      body: { self_service: true },
    });
    expect(toggle.status).toBe(200);
    expect(toggle.data.domain.self_service).toBe(true);

    // bootstrap 里出现自助域名
    const boot = await call(app, "/api/bootstrap", { token: user2 });
    expect(boot.data.self_service.length).toBe(1);
    expect(boot.data.self_service[0].full_domain).toBe("app.example.com");

    // 用户自助申请
    const claim = await call(app, "/api/rentals/claim", {
      method: "POST",
      token: user2,
      body: { domain_id: domainId, prefix: "11" },
    });
    expect(claim.status).toBe(200);
    expect(claim.data.rental.prefix).toBe("11");
    expect(claim.data.rental.renter_user_id).toBe(reg2.data.user.id);

    // 用户现在能看到 scoped domain
    const boot2 = await call(app, "/api/bootstrap", { token: user2 });
    expect(boot2.data.domains.some((d: any) => d.scoped_domain === "11.app.example.com")).toBe(true);

    // 重复申请冲突
    const conflict = await call(app, "/api/rentals/claim", {
      method: "POST",
      token: user2,
      body: { domain_id: domainId, prefix: "11" },
    });
    expect(conflict.status).toBe(409);

    // 缺前缀
    const noPrefix = await call(app, "/api/rentals/claim", {
      method: "POST",
      token: user2,
      body: { domain_id: domainId, prefix: "" },
    });
    expect(noPrefix.status).toBe(400);
  });

  it("cron 接口需要令牌", async () => {
    const env = testEnv({ CRON_TOKEN: "cron-secret" });
    const app = createApp(new MemoryStore(), env);
    const noToken = await call(app, "/api/cron", { method: "POST", body: {} });
    expect(noToken.status).toBe(403);
    const ok = await call(app, "/api/cron", { method: "POST", body: { token: "cron-secret" } });
    expect(ok.status).toBe(200);
  });
});
