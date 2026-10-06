"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
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
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@/lib/hooks";
import { api, clearCache } from "@/lib/api";
import { expiryLabel, formatDate, statusColor } from "@/lib/format";
import type { AccountInfo, DnsRecordInfo, DomainInfo } from "@/lib/types";

interface Detail {
  domain: DomainInfo;
  account: AccountInfo | null;
  dns_records: DnsRecordInfo[];
}

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"];

export default function DomainDetailPage() {
  const { user } = useAuth();
  const [id, setId] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("");
  const [editRecord, setEditRecord] = useState<DnsRecordInfo | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [nsWarning, setNsWarning] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setId(params.get("id"));
    setPrefix(params.get("prefix") ?? "");
  }, []);

  const detailPath = id
    ? `/api/domains/${id}${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ""}`
    : null;
  const { data, loading, error, reloading, reload } = useQuery<Detail>(detailPath);
  const isAdmin = user?.role === "admin";

  async function refreshLive() {
    if (!id) return;
    try {
      await api(`/api/domains/${id}/dns?refresh=1${prefix ? `&prefix=${encodeURIComponent(prefix)}` : ""}`);
      clearCache(`/api/domains/${id}`);
      setNsWarning(null);
      await reload();
    } catch (e: any) {
      if (e?.code === "external_nameservers") setNsWarning(e.message);
      else alert(e?.message ?? "刷新失败");
    }
  }

  async function removeRecord(r: DnsRecordInfo) {
    if (!confirm(`删除记录 ${r.type} ${r.name} → ${r.content}？`)) return;
    try {
      await api(`/api/dns/${r.id}`, { method: "DELETE" });
      clearCache(`/api/domains/${id}`);
      setNsWarning(null);
      await reload();
    } catch (e: any) {
      if (e?.code === "external_nameservers") setNsWarning(e.message);
      else alert(e?.message ?? "删除失败");
    }
  }

  async function renew() {
    if (!id) return;
    try {
      const res = await api<{ message: string }>(`/api/domains/${id}/renew`, { method: "POST" });
      alert(res.message ?? "续期成功");
      clearCache(`/api/domains/${id}`);
      await reload();
    } catch (e: any) {
      alert(e?.message ?? "续期失败");
    }
  }

  async function removeDomain() {
    if (!id || !data) return;
    if (!confirm(`确定删除 ${data.domain.full_domain}？`)) return;
    try {
      await api(`/api/domains/${id}`, { method: "DELETE" });
      clearCache();
      window.location.href = "/domains/";
    } catch (e: any) {
      alert(e?.message ?? "删除失败");
    }
  }

  return (
    <AppShell>
      <Link href="/domains" className="mb-4 inline-flex items-center gap-1 text-xs text-muted hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" /> 返回域名列表
      </Link>

      {!id || (loading && !data) ? (
        <div className="flex justify-center py-20"><Spinner className="h-6 w-6 text-brand" /></div>
      ) : error ? (
        <Card className="border-rose-500/40"><CardBody className="text-sm text-rose-300">{error}</CardBody></Card>
      ) : data ? (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold text-slate-100">
                {data.domain.scoped_domain || data.domain.full_domain}
              </h1>
              <p className="text-xs text-muted">
                {data.domain.rental_prefix ? `${data.domain.full_domain} 的子域名 · ` : ""}
                {data.account?.label ?? "—"} · DNSHE ID #{data.domain.dnshe_subdomain_id}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={renew}>
                续期
              </Button>
              {isAdmin && (
                <Button variant="danger" size="sm" onClick={removeDomain}>
                  <Trash2 className="h-3.5 w-3.5" /> 删除域名
                </Button>
              )}
            </div>
          </div>

          <Card className="mb-5">
            <CardBody className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
              <Field label="状态">
                <Badge className={statusColor(data.domain.status)}>{data.domain.status}</Badge>
              </Field>
              <Field label="到期时间">{expiryLabel(data.domain.expires_at, data.domain.never_expires)}</Field>
              <Field label="根域名">{data.domain.rootdomain}</Field>
              <Field label="所属账户">{data.account?.label ?? "—"}</Field>
              <Field label="DNSHE ID">#{data.domain.dnshe_subdomain_id}</Field>
              <Field label="租借范围">{data.domain.scoped_domain || data.domain.full_domain}</Field>
            </CardBody>
          </Card>

          {nsWarning && (
            <Card className="mb-5 border-amber-500/40 bg-amber-500/5">
              <CardBody className="flex items-start gap-2 text-sm text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>{nsWarning}</div>
              </CardBody>
            </Card>
          )}

          <Card>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">DNS 记录（{data.dns_records.length}）</h2>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={refreshLive} loading={reloading}>
                  <RefreshCw className="h-3.5 w-3.5" /> 从 DNSHE 刷新
                </Button>
                <Button size="sm" onClick={() => setShowAdd(true)}>
                  <Plus className="h-3.5 w-3.5" /> 添加记录
                </Button>
              </div>
            </div>
            <CardBody className="p-0">
              {data.dns_records.length === 0 ? (
                <EmptyState title="暂无 DNS 记录" hint="点击「添加记录」或从 DNSHE 刷新" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted">
                        <th className="px-4 py-2 font-medium">类型</th>
                        <th className="px-4 py-2 font-medium">名称</th>
                        <th className="px-4 py-2 font-medium">内容</th>
                        <th className="px-4 py-2 font-medium">TTL</th>
                        <th className="px-4 py-2 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.dns_records.map((r) => (
                        <tr key={r.id} className="border-b border-border/60 last:border-0">
                          <td className="px-4 py-2.5"><Badge className="border-slate-500/30 bg-slate-500/10">{r.type}</Badge></td>
                          <td className="px-4 py-2.5 text-slate-300">{r.name}</td>
                          <td className="max-w-[280px] truncate px-4 py-2.5 text-slate-300" title={r.content}>
                            {r.content}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted">{r.ttl}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => setEditRecord(r)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => removeRecord(r)}>
                                <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                              </Button>
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

          <p className="mt-3 text-[11px] text-slate-500">
            本地缓存更新于 {formatDate(data.dns_records[0]?.updated_at ?? null)}；写操作会实时提交到 DNSHE。
          </p>

          {showAdd && (
            <RecordModal
              domainId={data.domain.id}
              prefix={data.domain.rental_prefix}
              scopedDomain={data.domain.scoped_domain}
              onClose={() => setShowAdd(false)}
              onDone={async () => {
                clearCache(`/api/domains/${id}`);
                await reload();
              }}
            />
          )}
          {editRecord && (
            <RecordModal
              domainId={data.domain.id}
              prefix={data.domain.rental_prefix}
              scopedDomain={data.domain.scoped_domain}
              record={editRecord}
              onClose={() => setEditRecord(null)}
              onDone={async () => {
                clearCache(`/api/domains/${id}`);
                await reload();
              }}
            />
          )}
        </>
      ) : null}
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-slate-200">{children}</div>
    </div>
  );
}

function RecordModal({
  domainId,
  prefix,
  scopedDomain,
  record,
  onClose,
  onDone,
}: {
  domainId: string;
  prefix?: string;
  scopedDomain?: string;
  record?: DnsRecordInfo;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const editing = !!record;
  const [type, setType] = useState(record?.type ?? "A");
  const [name, setName] = useState(record?.name ?? "@");
  const [content, setContent] = useState(record?.content ?? "");
  const [ttl, setTtl] = useState(String(record?.ttl ?? 600));
  const [priority, setPriority] = useState(record?.priority != null ? String(record.priority) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body: Record<string, unknown> = { type, name, content, ttl: Number(ttl) };
    if (priority !== "") body.priority = Number(priority);
    try {
      if (editing && record) {
        await api(`/api/dns/${record.id}`, { method: "PATCH", body });
      } else {
        await api("/api/dns", { method: "POST", body: { ...body, domain_id: domainId, prefix } });
      }
      await onDone();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? "编辑 DNS 记录" : "添加 DNS 记录"}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>类型</Label>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {RECORD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{prefix ? `名称（相对 ${scopedDomain}，@ = 该子域名本身）` : "名称（@ 表示本域名）"}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="@" />
          </div>
        </div>
        <div>
          <Label>内容</Label>
          <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="1.2.3.4" required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>TTL</Label>
            <Input type="number" value={ttl} onChange={(e) => setTtl(e.target.value)} />
          </div>
          {(type === "MX" || type === "SRV") && (
            <div>
              <Label>优先级</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
          )}
        </div>
        {err && <p className="text-xs text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={busy}>
            保存
          </Button>
        </div>
      </form>
    </Modal>
  );
}
