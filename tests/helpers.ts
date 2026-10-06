import type { Store } from "../src/server/storage/store";
import type { Env } from "../src/server/types";

/** 内存版 Store，用于测试（等价于 KV 的 get/put/del/list） */
export class MemoryStore implements Store {
  private map = new Map<string, string>();

  async get<T = unknown>(key: string): Promise<T | null> {
    const v = this.map.get(key);
    return v == null ? null : (JSON.parse(v) as T);
  }

  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
}

export function testEnv(overrides: Partial<Env> = {}): Env {
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  return {
    DNSHE_KV: null,
    JWT_SECRET: "test-secret-please-change",
    ENCRYPTION_KEY: key,
    DNSHE_API_BASE: "https://api.example.test/index.php?m=domain_hub",
    ...overrides,
  };
}

// ---------- DNSHE API mock ----------

interface MockSubdomain {
  id: number;
  subdomain: string;
  rootdomain: string;
  full_domain: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  never_expires: number;
}

interface MockRecord {
  id: number;
  record_id: string;
  name: string;
  type: string;
  content: string;
  ttl: number;
  priority: number | null;
  status: string;
}

export interface DnsheMockState {
  subdomains: MockSubdomain[];
  records: Map<number, MockRecord[]>;
}

export function createDnsheMock() {
  const state: DnsheMockState = { subdomains: [], records: new Map() };
  let seq = 100;
  let recSeq = 500;

  const json = (data: unknown) =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const handler = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const endpoint = url.searchParams.get("endpoint");
    const action = url.searchParams.get("action");
    const body = (globalThis as any).__lastBody ?? {};

    if (endpoint === "quota") {
      return json({ success: true, quota: { used: 0, base: 5, invite_bonus: 0, total: 5, available: 5 } });
    }

    if (endpoint === "subdomains") {
      if (action === "list") {
        return json({
          success: true,
          count: state.subdomains.length,
          subdomains: state.subdomains,
          pagination: { page: 1, per_page: 200, has_more: false },
        });
      }
      if (action === "register") {
        const id = ++seq;
        const full = `${body.subdomain}.${body.rootdomain}`;
        const sub: MockSubdomain = {
          id,
          subdomain: body.subdomain,
          rootdomain: body.rootdomain,
          full_domain: full,
          status: "active",
          created_at: new Date().toISOString(),
          expires_at: "2027-01-01T00:00:00Z",
          never_expires: 0,
        };
        state.subdomains.push(sub);
        return json({ success: true, message: "ok", subdomain_id: id, full_domain: full });
      }
      if (action === "get") {
        const id = Number(url.searchParams.get("subdomain_id"));
        const sub = state.subdomains.find((s) => s.id === id);
        return json({ success: true, subdomain: sub, dns_records: [], dns_count: 0 });
      }
      if (action === "renew") {
        return json({
          success: true,
          message: "renewed",
          new_expires_at: "2028-01-01T00:00:00Z",
          status: "active",
          charged_amount: 0,
        });
      }
      if (action === "delete") {
        const id = Number(body.subdomain_id);
        state.subdomains = state.subdomains.filter((s) => s.id !== id);
        state.records.delete(id);
        return json({ success: true, message: "deleted" });
      }
    }

    if (endpoint === "dns_records") {
      const sid = Number(url.searchParams.get("subdomain_id") ?? body.subdomain_id);
      const list = state.records.get(sid) ?? [];
      if (action === "list") {
        return json({ success: true, count: list.length, records: list });
      }
      if (action === "create") {
        const id = ++recSeq;
        const sub = state.subdomains.find((x) => x.id === sid);
        const full = sub?.full_domain;
        const rawName = (body.name ?? "@") as string;
        const name =
          !full || rawName === "@" || rawName === ""
            ? full ?? rawName
            : rawName.endsWith("." + full)
              ? rawName
              : `${rawName}.${full}`;
        const rec: MockRecord = {
          id,
          record_id: `rec_${id}`,
          name,
          type: body.type,
          content: body.content,
          ttl: body.ttl ?? 600,
          priority: body.priority ?? null,
          status: "active",
        };
        state.records.set(sid, [...list, rec]);
        return json({ success: true, message: "created", id, record_id: rec.record_id });
      }
      if (action === "update") {
        const rid = body.id ?? body.record_id;
        for (const [k, lst] of state.records) {
          state.records.set(
            k,
            lst.map((r) =>
              r.id === Number(rid) || r.record_id === rid
                ? {
                    ...r,
                    ...body,
                    id: r.id,
                    // 模拟 DNSHE：更新后 provider record_id 会变化
                    record_id: `rec_${r.id}_${Date.now().toString(36)}`,
                  }
                : r
            )
          );
        }
        return json({ success: true, message: "updated" });
      }
      if (action === "delete") {
        const rid = body.record_id ?? body.id;
        for (const [k, lst] of state.records) {
          state.records.set(
            k,
            lst.filter((r) => r.record_id !== rid && r.id !== Number(rid))
          );
        }
        return json({ success: true, message: "deleted" });
      }
    }

    return json({ success: false, error_code: "not_found", message: `unknown endpoint ${endpoint}/${action}` });
  };

  const originalFetch = globalThis.fetch;

  return {
    state,
    /** 安装 mock，返回卸载函数 */
    install() {
      (globalThis as any).fetch = (input: any, init?: any) => {
        if (init?.body) {
          try {
            (globalThis as any).__lastBody = JSON.parse(init.body);
          } catch {
            (globalThis as any).__lastBody = {};
          }
        } else {
          (globalThis as any).__lastBody = {};
        }
        return handler(input);
      };
      return () => {
        globalThis.fetch = originalFetch;
      };
    },
  };
}
