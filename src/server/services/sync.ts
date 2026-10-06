import type { Ctx } from "../context";
import { newId } from "../storage/repos";
import type { DnsheAccount, DnsRecord, Domain } from "../types";
import { decryptSecret } from "../lib/crypto";
import { DnsheClient, normalizeStatus, type DnsheSubdomain } from "./dnshe";

const STALE_MS = 6 * 60 * 60 * 1000; // 6 小时
const LOCK_MS = 5 * 60 * 1000; // 惰性同步去重窗口

export async function clientForAccount(ctx: Ctx, account: DnsheAccount): Promise<DnsheClient> {
  const secret = await decryptSecret(account.api_secret_enc, ctx.env.ENCRYPTION_KEY);
  return new DnsheClient({
    apiKey: account.api_key,
    apiSecret: secret,
    base: ctx.env.DNSHE_API_BASE,
  });
}

function toDomain(prev: Domain | undefined, accountId: string, s: DnsheSubdomain, now: string): Domain {
  return {
    id: prev?.id ?? newId(),
    account_id: accountId,
    dnshe_subdomain_id: s.id,
    subdomain: s.subdomain,
    rootdomain: s.rootdomain,
    full_domain: s.full_domain,
    status: normalizeStatus(s.status),
    expires_at: s.expires_at ?? null,
    never_expires: s.never_expires ?? 0,
    self_service: prev?.self_service ?? false,
    created_at: prev?.created_at ?? s.created_at ?? now,
    updated_at: now,
  };
}

export interface SyncResult {
  ok: boolean;
  accountId: string;
  label: string;
  count?: number;
  error?: string;
}

export async function syncAccount(ctx: Ctx, account: DnsheAccount): Promise<SyncResult> {
  try {
    const client = await clientForAccount(ctx, account);
    const { ok, items, error } = await client.listAllSubdomains();
    if (!ok) return { ok: false, accountId: account.id, label: account.label, error };

    const existing = (await ctx.domains.all()).filter((d) => d.account_id === account.id);
    const byDnsheId = new Map(existing.map((d) => [d.dnshe_subdomain_id, d]));
    const now = ctx.now();

    const records = items.map((s) => toDomain(byDnsheId.get(s.id), account.id, s, now));
    await ctx.domains.putMany(records);
    await ctx.domains.ensureIndexed(records.map((d) => d.id));
    await ctx.accounts.update(account.id, { last_synced_at: now });

    return { ok: true, accountId: account.id, label: account.label, count: records.length };
  } catch (e: any) {
    return { ok: false, accountId: account.id, label: account.label, error: e?.message ?? String(e) };
  }
}

export async function syncAll(ctx: Ctx, opts?: { onlyIds?: string[] }): Promise<SyncResult[]> {
  const accounts = await ctx.accounts.all();
  const targets = opts?.onlyIds ? accounts.filter((a) => opts.onlyIds!.includes(a.id)) : accounts;
  const results: SyncResult[] = [];
  for (const account of targets) {
    results.push(await syncAccount(ctx, account));
  }
  return results;
}

/** 惰性同步：有账户超过 6 小时未同步时，后台异步同步，不阻塞当前请求 */
export async function maybeLazySync(ctx: Ctx): Promise<boolean> {
  const accounts = await ctx.accounts.all();
  const stale = accounts.filter(
    (a) => !a.last_synced_at || Date.now() - Date.parse(a.last_synced_at) > STALE_MS
  );
  if (stale.length === 0) return false;

  const lock = await ctx.store.get<number>("meta_sync_lock");
  if (lock && Date.now() - lock < LOCK_MS) return false;
  await ctx.store.put("meta_sync_lock", Date.now());

  ctx.waitUntil(syncAll(ctx, { onlyIds: stale.map((a) => a.id) }).catch(() => undefined));
  return true;
}

/** 实时写入 DNSHE 后，刷新该域名在本地的 DNS 记录缓存 */
export async function refreshDnsCache(ctx: Ctx, domain: Domain): Promise<{ ok: boolean; error?: string }> {
  const account = await ctx.accounts.get(domain.account_id);
  if (!account) return { ok: false, error: "账户不存在" };
  const client = await clientForAccount(ctx, account);
  const res = await client.listDnsRecords(domain.dnshe_subdomain_id);
  if (!res.success) return { ok: false, error: res.error };

  const old = (await ctx.dnsRecords.all()).filter((r) => r.domain_id === domain.id);
  const idByRemote = new Map<string, string>();
  for (const r of old) {
    if (r.dnshe_record_id) idByRemote.set(r.dnshe_record_id, r.id);
  }
  await Promise.all(old.map((r) => ctx.dnsRecords.remove(r.id)));

  const now = ctx.now();
  const records: DnsRecord[] = (res.records ?? []).map((r: any) => {
    // 优先用内部模块 id（更新后稳定），provider record_id 会在 update 后变化
    const stableId = r.id != null ? String(r.id) : r.record_id != null ? String(r.record_id) : null;
    return {
      id: (stableId && idByRemote.get(stableId)) || newId(),
      domain_id: domain.id,
      dnshe_record_id: stableId,
      name: r.name,
      type: r.type,
      content: r.content,
      ttl: r.ttl ?? 600,
      priority: r.priority ?? null,
      proxied: !!r.proxied,
      status: r.status ?? "active",
      updated_at: now,
    };
  });
  await Promise.all(records.map((r) => ctx.dnsRecords.insert(r)));
  return { ok: true };
}

/** 把单个 DNSHE 子域名写入本地（注册后调用） */
export async function upsertDomain(
  ctx: Ctx,
  accountId: string,
  s: DnsheSubdomain
): Promise<Domain> {
  const existing = (await ctx.domains.all()).find(
    (d) => d.account_id === accountId && d.dnshe_subdomain_id === s.id
  );
  const rec = toDomain(existing, accountId, s, ctx.now());
  if (existing) {
    await ctx.domains.update(rec.id, rec);
  } else {
    await ctx.domains.insert(rec);
  }
  return rec;
}
