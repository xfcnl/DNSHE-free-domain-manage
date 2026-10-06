"use client";

import { AppShell } from "@/components/AppShell";
import { Card, CardBody, EmptyState, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import type { AuditInfo } from "@/lib/types";

export default function AdminAuditPage() {
  const { user } = useAuth();
  const { data, loading, error } = useQuery<{ logs: AuditInfo[] }>("/api/admin/audit");

  if (user && user.role !== "admin") {
    return (
      <AppShell>
        <Card><CardBody className="text-sm text-rose-300">需要管理员权限</CardBody></Card>
      </AppShell>
    );
  }

  const logs = data?.logs ?? [];

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="text-lg font-bold text-slate-100">审计日志</h1>
        <p className="text-xs text-muted">最近 200 条操作记录</p>
      </div>

      {error && <Card className="mb-4 border-rose-500/40"><CardBody className="text-sm text-rose-300">{error}</CardBody></Card>}

      <Card>
        <CardBody className="p-0">
          {loading && !data ? (
            <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-brand" /></div>
          ) : logs.length === 0 ? (
            <EmptyState title="暂无日志" />
          ) : (
            <div className="divide-y divide-border">
              {logs.map((l) => (
                <div key={l.id} className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="font-mono text-xs text-brand">{l.action}</span>
                    <span className="ml-2 text-slate-200">{l.target}</span>
                    {l.detail && <span className="ml-2 text-xs text-muted">{l.detail}</span>}
                  </div>
                  <span className="shrink-0 text-xs text-muted">{formatDate(l.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </AppShell>
  );
}
