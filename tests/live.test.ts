import { describe, it, expect } from "vitest";
import { DnsheClient } from "../src/server/services/dnshe";
import { createApp } from "../src/server/app";
import { MemoryStore, testEnv } from "./helpers";

const API_KEY = process.env.DNSHE_API_KEY;
const API_SECRET = process.env.DNSHE_API_SECRET;
const hasCreds = !!(API_KEY && API_SECRET);

/**
 * 真实 DNSHE 接口联调。仅在设置 DNSHE_API_KEY / DNSHE_API_SECRET 时运行：
 *   DNSHE_API_KEY=xxx DNSHE_API_SECRET=yyy npx vitest run tests/live.test.ts
 * 默认（npm test）会自动跳过。
 */
describe.skipIf(!hasCreds)("DNSHE 真实接口联调", () => {
  it("配额查询", async () => {
    const client = new DnsheClient({ apiKey: API_KEY!, apiSecret: API_SECRET! });
    const res = await client.quota();
    if (!res.success) console.error("quota error:", res.error, res.errorCode);
    expect(res.success).toBe(true);
    console.log("[live] quota =", JSON.stringify(res.quota));
  });

  it("子域名列表 + 详情 + DNS 记录", async () => {
    const client = new DnsheClient({ apiKey: API_KEY!, apiSecret: API_SECRET! });
    const { ok, items, error } = await client.listAllSubdomains();
    if (!ok) console.error("list error:", error);
    expect(ok).toBe(true);
    console.log(`[live] subdomains = ${items.length}`);
    for (const s of items.slice(0, 10)) {
      console.log(`  - ${s.full_domain} (${s.status}) expires=${s.expires_at ?? "never"}`);
    }

    if (items.length > 0) {
      const first = items[0];
      const detail = await client.getSubdomain(first.id);
      expect(detail.success).toBe(true);
      expect(detail.subdomain?.full_domain).toBe(first.full_domain);

      const dns = await client.listDnsRecords(first.id);
      expect(dns.success).toBe(true);
      console.log(`[live] dns records for ${first.full_domain} = ${(dns.records ?? []).length}`);
    }
  });

  it("完整服务端流程：添加账户 → 同步真实域名 → bootstrap", async () => {
    const app = createApp(new MemoryStore(), testEnv({ DNSHE_API_BASE: undefined }));

    const post = (path: string, body: unknown, token?: string) =>
      app.fetch(
        new Request(`http://test${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        })
      );
    const get = (path: string, token?: string) =>
      app.fetch(
        new Request(`http://test${path}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
      );

    const reg = await (await post("/api/auth", { action: "register", username: "admin", password: "secret123" })).json();
    const token = (reg as any).token as string;
    expect(token).toBeTruthy();

    const accRes = await post(
      "/api/accounts",
      { label: "联调账户", api_key: API_KEY, api_secret: API_SECRET },
      token
    );
    const acc = await accRes.json();
    expect(accRes.status, JSON.stringify(acc)).toBe(200);
    console.log("[live] 账户添加成功, 配额 =", JSON.stringify((acc as any).quota));
    console.log("[live] 首次同步 =", JSON.stringify((acc as any).sync));

    const boot = await (await get("/api/bootstrap", token)).json();
    console.log(`[live] bootstrap domains = ${(boot as any).domains.length}, stats =`, JSON.stringify((boot as any).stats));
    expect((boot as any).user.role).toBe("admin");

    // 验证域名数据形状
    for (const d of (boot as any).domains.slice(0, 5)) {
      console.log(`  - ${d.full_domain} account=${d.account_label} status=${d.status}`);
      expect(d.full_domain).toContain(".");
    }
  });
});

describe.skipIf(hasCreds)("DNSHE 真实接口联调（未提供凭证时跳过）", () => {
  it("提示如何运行", () => {
    console.log(
      "[live] 未设置 DNSHE_API_KEY / DNSHE_API_SECRET，已跳过真实接口测试。"
    );
    expect(true).toBe(true);
  });
});
