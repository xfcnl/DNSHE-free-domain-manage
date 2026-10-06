export interface DnsheCredentials {
  apiKey: string;
  apiSecret: string;
  base?: string;
}

export interface DnsheResponse {
  success: boolean;
  error?: string;
  errorCode?: string;
  [key: string]: any;
}

export interface DnsheSubdomain {
  id: number;
  subdomain: string;
  rootdomain: string;
  full_domain: string;
  status: string;
  created_at?: string;
  updated_at?: string;
  expires_at?: string | null;
  never_expires?: number;
}

export interface DnsheDnsRecord {
  id: number;
  record_id?: string;
  name: string;
  type: string;
  content: string;
  ttl: number;
  priority?: number | null;
  line?: string | null;
  proxied?: boolean;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

const DEFAULT_BASE = "https://api005.dnshe.com/index.php?m=domain_hub";

/** DNSHE 实际返回的状态值不统一（如 "Registered"），统一归一化 */
export function normalizeStatus(status: unknown): string {
  const s = String(status ?? "").toLowerCase();
  if (s === "registered" || s === "active" || s === "ok" || s === "normal") return "active";
  if (s === "suspended" || s === "pending" || s === "hold") return "suspended";
  if (s === "expired") return "expired";
  return s || "active";
}

/** 把 DNSHE 的报错翻译成更清晰的中文，并给出稳定的 error_code */
export function normalizeDnsheError(
  error?: string,
  errorCode?: string
): { error: string; error_code?: string } {
  const msg = error ?? "";
  if (/external nameservers/i.test(msg) || /delegated to external/i.test(msg)) {
    return {
      error:
        "该域名已委派给外部 DNS 服务器，DNSHE 平台无法管理它的 DNS 记录。请先到 DNSHE 后台把该域名改回平台 nameservers（删除指向外部的 NS 记录）后再操作。",
      error_code: "external_nameservers",
    };
  }
  if (/insufficient balance/i.test(msg)) {
    return { error: "账户余额不足，无法完成该操作。", error_code: "insufficient_balance" };
  }
  return { error: msg, error_code: errorCode };
}

export class DnsheClient {
  private base: string;

  constructor(private creds: DnsheCredentials) {
    this.base = creds.base || DEFAULT_BASE;
  }

  private async request(
    endpoint: string,
    action: string | null,
    method: "GET" | "POST" | "DELETE",
    query?: Record<string, unknown>,
    body?: Record<string, unknown>
  ): Promise<DnsheResponse> {
    const url = new URL(this.base);
    url.searchParams.set("endpoint", endpoint);
    if (action) url.searchParams.set("action", action);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        headers: {
          "X-API-Key": this.creds.apiKey,
          "X-API-Secret": this.creds.apiSecret,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e: any) {
      return { success: false, error: `网络错误: ${e?.message ?? e}` };
    }

    let json: any;
    try {
      json = await res.json();
    } catch {
      return { success: false, error: `HTTP ${res.status}，返回非 JSON` };
    }

    if (!json || json.success !== true) {
      return {
        success: false,
        error: json?.message || json?.error || `HTTP ${res.status}`,
        errorCode: json?.error_code,
        ...json,
      };
    }
    return json as DnsheResponse;
  }

  // ----- 子域名 -----

  async listSubdomains(page = 1, perPage = 200): Promise<DnsheResponse> {
    return this.request("subdomains", "list", "GET", { page, per_page: perPage });
  }

  /** 拉取某个账户下全部子域名（自动翻页） */
  async listAllSubdomains(): Promise<{ ok: boolean; items: DnsheSubdomain[]; error?: string }> {
    const items: DnsheSubdomain[] = [];
    let page = 1;
    for (;;) {
      const res = await this.listSubdomains(page, 200);
      if (!res.success) return { ok: false, items, error: res.error };
      const batch: DnsheSubdomain[] = res.subdomains ?? [];
      items.push(...batch);
      const hasMore = res.pagination?.has_more ?? batch.length >= 200;
      if (!hasMore) break;
      page += 1;
      if (page > 100) break; // 安全上限
    }
    return { ok: true, items };
  }

  async registerSubdomain(subdomain: string, rootdomain: string): Promise<DnsheResponse> {
    return this.request("subdomains", "register", "POST", undefined, { subdomain, rootdomain });
  }

  async getSubdomain(subdomainId: number): Promise<DnsheResponse> {
    return this.request("subdomains", "get", "GET", { subdomain_id: subdomainId });
  }

  async deleteSubdomain(subdomainId: number): Promise<DnsheResponse> {
    return this.request("subdomains", "delete", "POST", undefined, { subdomain_id: subdomainId });
  }

  async renewSubdomain(subdomainId: number): Promise<DnsheResponse> {
    return this.request("subdomains", "renew", "POST", undefined, { subdomain_id: subdomainId });
  }

  // ----- DNS 记录 -----

  async listDnsRecords(subdomainId: number): Promise<DnsheResponse> {
    return this.request("dns_records", "list", "GET", { subdomain_id: subdomainId });
  }

  async createDnsRecord(payload: Record<string, unknown>): Promise<DnsheResponse> {
    return this.request("dns_records", "create", "POST", undefined, payload);
  }

  async updateDnsRecord(payload: Record<string, unknown>): Promise<DnsheResponse> {
    return this.request("dns_records", "update", "POST", undefined, payload);
  }

  async deleteDnsRecord(payload: Record<string, unknown>): Promise<DnsheResponse> {
    return this.request("dns_records", "delete", "POST", undefined, payload);
  }

  // ----- 配额 -----

  async quota(): Promise<DnsheResponse> {
    return this.request("quota", null, "GET");
  }
}
