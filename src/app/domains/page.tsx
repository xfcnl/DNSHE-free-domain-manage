"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw, Search, Share2, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Input,
  Label,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { api, clearCache } from "@/lib/api";
import { expiryLabel, statusColor } from "@/lib/format";
import type { Bootstrap, DomainInfo, SelfServiceDomain } from "@/lib/types";

function detailHref(d: DomainInfo) {
  const base = `/domain?id=${d.id}`;
  return d.rental_prefix ? `${base}&prefix=${encodeURIComponent(d.rental_prefix)}` : base;
}

export default function DomainsPage() {
  const { data, loading, error, reloading, reload } = useQuery<Bootstrap>("/api/bootstrap");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [showRegister, setShowRegister] = useState(false);
  const [showClaim, setShowClaim] = useState(false);
  const [rentTarget, setRentTarget] = useState<DomainInfo | null>(null);

  const isAdmin = data?.user.role === "admin";

  const filtered = useMemo(() => {
    const list = data?.domains ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((d) => {
      if (q && !d.full_domain.toLowerCase().includes(q)) return false;
      if (statusFilter && d.status !== statusFilter) return false;
      if (accountFilter && d.account_id !== accountFilter) return false;
      return true;
    });
  }, [data?.domains, search, statusFilter, accountFilter]);

  async function refresh() {
    clearCache();
    await reload();
  }

  async function removeDomain(d: DomainInfo) {
    if (!confirm(`确定删除 ${d.full_domain}？这会同时删除远端域名与所有 DNS 记录。`)) return;
    try {
      await api(`/api/domains/${d.id}`, { method: "DELETE" });
      await refresh();
    } catch (e: any) {
      alert(e?.message ?? "删除失败");
    }
  }

  async function renew(d: DomainInfo) {
    try {
      const res = await api<{ message: string }>(`/api/domains/${d.id}/renew`, { method: "POST" });
      alert(res.message ?? "续期成功");
      await refresh();
    } catch (e: any) {
      alert(e?.message ?? "续期失败");
    }
  }

  async function toggleSelfService(d: DomainInfo) {
    try {
      await api(`/api/domains/${d.id}`, { method: "PATCH", body: { self_service: !d.self_service } });
      await refresh();
    } catch (e: any) {
      alert(e?.message ?? "操作失败");
    }
  }

  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100">域名</h1>
          <p className="text-xs text-muted">
            {isAdmin ? "全部账户下的免费域名" : "租借给你的域名"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} loading={reloading}>
            <RefreshCw className="h-3.5 w-3.5" /> 刷新
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => setShowRegister(true)}>
              <Plus className="h-3.5 w-3.5" /> 注册子域名
            </Button>
          )}
          {!isAdmin && (data?.self_service?.length ?? 0) > 0 && (
            <Button size="sm" onClick={() => setShowClaim(true)}>
              <Plus className="h-3.5 w-3.5" /> 自助申请子域名
            </Button>
          )}
        </div>
      </div>

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <Label>搜索</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                className="pl-9"
                placeholder="按完整域名搜索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="w-36">
            <Label>状态</Label>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">全部</option>
              <option value="active">active</option>
              <option value="suspended">suspended</option>
              <option value="expired">expired</option>
            </Select>
          </div>
          {isAdmin && (
            <div className="w-44">
              <Label>账户</Label>
              <Select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
                <option value="">全部</option>
                {(data?.accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </CardBody>
      </Card>

      {error && <Card className="mb-4 border-rose-500/40"><CardBody className="text-sm text-rose-300">{error}</CardBody></Card>}

      <Card>
        <CardBody className="p-0">
          {loading && !data ? (
            <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-brand" /></div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title="没有匹配的域名"
              hint={
                isAdmin
                  ? "点击右上角注册一个子域名"
                  : (data?.self_service?.length ?? 0) > 0
                    ? "点击右上角「自助申请子域名」免费获取一个"
                    : "联系管理员分配域名给你"
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">域名</th>
                    <th className="px-4 py-2 font-medium">状态</th>
                    <th className="px-4 py-2 font-medium">到期</th>
                    <th className="px-4 py-2 font-medium">账户</th>
                    <th className="px-4 py-2 font-medium">DNSHE ID</th>
                    {isAdmin && <th className="px-4 py-2 font-medium">租借给</th>}
                    <th className="px-4 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => (
                    <tr key={`${d.id}:${d.rental_prefix ?? ""}`} className="border-b border-border/60 last:border-0 hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5">
                        <Link href={detailHref(d)} className="text-slate-100 hover:text-brand">
                          {d.scoped_domain || d.full_domain}
                        </Link>
                        {d.rental_prefix ? (
                          <span className="ml-2 text-[11px] text-muted">{d.full_domain} 的子域名</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge className={statusColor(d.status)}>{d.status}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted">
                        {expiryLabel(d.expires_at, d.never_expires)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted">{d.account_label ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted">#{d.dnshe_subdomain_id}</td>
                      {isAdmin && (
                        <td className="px-4 py-2.5 text-xs">
                          {d.rentals && d.rentals.length > 0 ? (
                            <div className="flex flex-col gap-0.5">
                              {d.rentals.map((r) => (
                                <span key={r.id} className="text-brand">
                                  {r.scoped_domain} → {r.renter}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => renew(d)}>
                            续期
                          </Button>
                          {isAdmin && (
                            <Button variant="ghost" size="sm" onClick={() => setRentTarget(d)}>
                              <Share2 className="h-3.5 w-3.5" /> 租借
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className={d.self_service ? "text-emerald-300" : ""}
                              onClick={() => toggleSelfService(d)}
                            >
                              {d.self_service ? "关闭自助" : "开放自助"}
                            </Button>
                          )}
                          {isAdmin && (
                            <Button variant="ghost" size="sm" onClick={() => removeDomain(d)}>
                              <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {isAdmin && (
        <RegisterModal
          open={showRegister}
          onClose={() => setShowRegister(false)}
          accounts={data?.accounts ?? []}
          rootdomains={Array.from(new Set((data?.domains ?? []).map((d) => d.rootdomain)))}
          onDone={refresh}
        />
      )}

      {isAdmin && rentTarget && (
        <RentModal
          domain={rentTarget}
          onClose={() => setRentTarget(null)}
          onDone={refresh}
        />
      )}

      {!isAdmin && showClaim && (
        <ClaimModal
          domains={data?.self_service ?? []}
          onClose={() => setShowClaim(false)}
          onDone={refresh}
        />
      )}
    </AppShell>
  );
}

function RegisterModal({
  open,
  onClose,
  accounts,
  rootdomains,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accounts: { id: string; label: string }[];
  rootdomains: string[];
  onDone: () => Promise<void>;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [subdomain, setSubdomain] = useState("");
  const [rootdomain, setRootdomain] = useState(rootdomains[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/domains/register", {
        method: "POST",
        body: { account_id: accountId, subdomain, rootdomain },
      });
      await onDone();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "注册失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="注册子域名">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>DNSHE 账户</Label>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>子域名前缀</Label>
            <Input value={subdomain} onChange={(e) => setSubdomain(e.target.value)} placeholder="myapp" required />
          </div>
          <div>
            <Label>根域名</Label>
            <Input
              list="rootdomains"
              value={rootdomain}
              onChange={(e) => setRootdomain(e.target.value)}
              placeholder="example.com"
              required
            />
            <datalist id="rootdomains">
              {rootdomains.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
        </div>
        {err && <p className="text-xs text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={busy}>
            注册
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RentModal({
  domain,
  onClose,
  onDone,
}: {
  domain: DomainInfo;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [users, setUsers] = useState<{ id: string; username: string }[]>([]);
  const [renterId, setRenterId] = useState("");
  const [prefix, setPrefix] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ users: { id: string; username: string }[] }>("/api/admin/users")
      .then((res) => {
        setUsers(res.users);
        setRenterId(res.users[0]?.id ?? "");
      })
      .catch((e) => setErr(e?.message ?? "加载用户失败"));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/rentals", {
        method: "POST",
        body: { domain_id: domain.id, renter_user_id: renterId, prefix: prefix.trim(), expires_at: expiresAt || null, notes },
      });
      await onDone();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "租借失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`租借 ${domain.full_domain}`}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>租给用户</Label>
          <Select value={renterId} onChange={(e) => setRenterId(e.target.value)} required>
            {users.length === 0 && <option value="">（没有其他用户）</option>}
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>子域名前缀（留空 = 租借整个域名）</Label>
          <Input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="例如 11"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            当前域名：{domain.full_domain}
            {prefix.trim() ? ` → 租借 ${prefix.trim()}.${domain.full_domain}` : "（整个域名）"}
          </p>
        </div>
        <div>
          <Label>到期时间（留空为永久）</Label>
          <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
        <div>
          <Label>备注</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="可选" />
        </div>
        {err && <p className="text-xs text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={busy} disabled={!renterId}>
            确认租借
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ClaimModal({
  domains,
  onClose,
  onDone,
}: {
  domains: SelfServiceDomain[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [domainId, setDomainId] = useState(domains[0]?.id ?? "");
  const [prefix, setPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selected = domains.find((d) => d.id === domainId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/rentals/claim", {
        method: "POST",
        body: { domain_id: domainId, prefix: prefix.trim() },
      });
      await onDone();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "申请失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="自助申请子域名">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>选择域名</Label>
          <Select value={domainId} onChange={(e) => setDomainId(e.target.value)} required>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.full_domain}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>子域名前缀</Label>
          <Input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="例如 11"
            required
          />
          {selected && (
            <p className="mt-1 text-[11px] text-slate-500">
              将申请：{prefix.trim() ? `${prefix.trim()}.${selected.full_domain}` : `?.${selected.full_domain}`}
              {selected.taken_prefixes.length > 0
                ? ` · 已占用：${selected.taken_prefixes.join(", ")}`
                : " · 暂无占用"}
            </p>
          )}
        </div>
        <p className="text-[11px] text-slate-500">
          申请成功后子域名会自动租借给你，你可以在「域名」页管理它的 DNS 记录。
        </p>
        {err && <p className="text-xs text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={busy}>
            申请
          </Button>
        </div>
      </form>
    </Modal>
  );
}
