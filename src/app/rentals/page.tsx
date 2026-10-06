"use client";

import { useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, CardBody, EmptyState, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@/lib/hooks";
import { api, clearCache } from "@/lib/api";
import { expiryLabel, formatDate } from "@/lib/format";
import type { Bootstrap, RentalInfo } from "@/lib/types";

const RENTAL_COLORS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  revoked: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  expired: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export default function RentalsPage() {
  const { user } = useAuth();
  const { data, loading, error, reloading, reload } = useQuery<Bootstrap>("/api/bootstrap");
  const [busyId, setBusyId] = useState<string | null>(null);
  const isAdmin = user?.role === "admin";

  const domainName = (r: RentalInfo) => {
    const d = (data?.domains ?? []).find((x) => x.id === r.domain_id);
    const full = d?.full_domain ?? r.domain_id;
    return r.prefix ? `${r.prefix}.${full}` : full;
  };

  async function revoke(r: RentalInfo) {
    setBusyId(r.id);
    try {
      await api(`/api/rentals/${r.id}`, { method: "PATCH", body: { status: "revoked" } });
      clearCache();
      await reload();
    } catch (e: any) {
      alert(e?.message ?? "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(r: RentalInfo) {
    if (!confirm("确定删除这条租借记录？")) return;
    setBusyId(r.id);
    try {
      await api(`/api/rentals/${r.id}`, { method: "DELETE" });
      clearCache();
      await reload();
    } catch (e: any) {
      alert(e?.message ?? "删除失败");
    } finally {
      setBusyId(null);
    }
  }

  const rentals = data?.rentals ?? [];

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-100">租借</h1>
          <p className="text-xs text-muted">{isAdmin ? "全部租借记录" : "分配给你的域名"}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()} loading={reloading}>
          <RefreshCw className="h-3.5 w-3.5" /> 刷新
        </Button>
      </div>

      {error && <Card className="mb-4 border-rose-500/40"><CardBody className="text-sm text-rose-300">{error}</CardBody></Card>}

      <Card>
        <CardBody className="p-0">
          {loading && !data ? (
            <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-brand" /></div>
          ) : rentals.length === 0 ? (
            <EmptyState title="暂无租借记录" hint={isAdmin ? "在域名页点击「租借」分配域名" : "联系管理员分配域名给你"} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">域名</th>
                    {isAdmin && <th className="px-4 py-2 font-medium">租给</th>}
                    <th className="px-4 py-2 font-medium">租借时间</th>
                    <th className="px-4 py-2 font-medium">到期</th>
                    <th className="px-4 py-2 font-medium">状态</th>
                    {isAdmin && <th className="px-4 py-2 text-right font-medium">操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {rentals.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5 text-slate-100">{domainName(r)}</td>
                      {isAdmin && <td className="px-4 py-2.5 text-brand">{r.renter}</td>}
                      <td className="px-4 py-2.5 text-xs text-muted">{formatDate(r.rented_at)}</td>
                      <td className="px-4 py-2.5 text-xs text-muted">
                        {r.expires_at ? expiryLabel(r.expires_at, 0) : "永久"}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge className={RENTAL_COLORS[r.status] ?? RENTAL_COLORS.revoked}>{r.status}</Badge>
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-1">
                            {r.status === "active" && (
                              <Button variant="ghost" size="sm" loading={busyId === r.id} onClick={() => revoke(r)}>
                                回收
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" loading={busyId === r.id} onClick={() => remove(r)}>
                              <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </AppShell>
  );
}
