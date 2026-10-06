"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, CardBody, EmptyState, Spinner } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { api, clearCache } from "@/lib/api";
import { expiryLabel, statusColor } from "@/lib/format";
import type { Bootstrap } from "@/lib/types";

export default function DashboardPage() {
  const { data, loading, error, reloading, reload } = useQuery<Bootstrap>("/api/bootstrap");
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (data?.syncing) {
      const t = setTimeout(() => void reload(), 6000);
      return () => clearTimeout(t);
    }
  }, [data?.syncing, reload]);

  async function manualSync() {
    setSyncing(true);
    try {
      await api("/api/sync", { method: "POST" });
      clearCache();
      await reload();
    } catch (e: any) {
      alert(e?.message ?? "同步失败");
    } finally {
      setSyncing(false);
    }
  }

  const stats = data?.stats;
  const expiring = (data?.domains ?? [])
    .filter((d) => !d.never_expires && d.expires_at)
    .sort((a, b) => Date.parse(a.expires_at!) - Date.parse(b.expires_at!))
    .slice(0, 6);

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-100">仪表盘</h1>
          <p className="text-xs text-muted">多账户免费域名总览</p>
        </div>
        <div className="flex items-center gap-2">
          {data?.syncing && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <Spinner className="h-3 w-3" /> 后台同步中…
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => void reload()} loading={reloading}>
            <RefreshCw className="h-3.5 w-3.5" /> 刷新
          </Button>
          {data?.user.role === "admin" && (
            <Button size="sm" onClick={manualSync} loading={syncing}>
              <RefreshCw className="h-3.5 w-3.5" /> 同步 DNSHE
            </Button>
          )}
        </div>
      </div>

      {error && <Card className="mb-4 border-rose-500/40"><CardBody className="text-sm text-rose-300">{error}</CardBody></Card>}

      {loading && !data ? (
        <div className="flex justify-center py-20"><Spinner className="h-6 w-6 text-brand" /></div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Stat label="域名总数" value={stats?.domains ?? 0} />
            <Stat label="活跃" value={stats?.active ?? 0} />
            <Stat label="30 天内到期" value={stats?.expiringSoon ?? 0} tone="warn" />
            {data?.user.role === "admin" && <Stat label="DNSHE 账户" value={stats?.accounts ?? 0} />}
            {data?.user.role === "admin" && <Stat label="用户数" value={stats?.users ?? 0} />}
            <Stat label="有效租借" value={stats?.rentals ?? 0} />
          </div>

          <Card>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">即将到期</h2>
              <Link href="/domains" className="text-xs text-brand hover:underline">
                查看全部域名 →
              </Link>
            </div>
            <CardBody className="p-0">
              {expiring.length === 0 ? (
                <EmptyState title="没有即将到期的域名" hint="所有域名都很安全讷～" />
              ) : (
                <div className="divide-y divide-border">
                  {expiring.map((d) => (
                    <div key={d.id} className="flex items-center justify-between px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-slate-100">{d.full_domain}</div>
                        <div className="text-xs text-muted">{d.account_label ?? "—"}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted">{expiryLabel(d.expires_at, d.never_expires)}</span>
                        <Badge className={statusColor(d.status)}>{d.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <Card>
      <CardBody className="py-3">
        <div className="text-xs text-muted">{label}</div>
        <div className={`mt-1 text-2xl font-bold ${tone === "warn" && value > 0 ? "text-amber-300" : "text-slate-100"}`}>
          {value}
        </div>
      </CardBody>
    </Card>
  );
}
