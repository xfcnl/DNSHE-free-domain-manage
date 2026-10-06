"use client";

import { useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  Input,
  Label,
  Modal,
  Spinner,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@/lib/hooks";
import { api, clearCache } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { AccountInfo } from "@/lib/types";

export default function AccountsPage() {
  const { user } = useAuth();
  const { data, loading, error, reloading, reload } = useQuery<{ accounts: AccountInfo[] }>("/api/accounts");
  const [showAdd, setShowAdd] = useState(false);
  const [syncing, setSyncing] = useState(false);

  if (user && user.role !== "admin") {
    return (
      <AppShell>
        <Card><CardBody className="text-sm text-rose-300">需要管理员权限</CardBody></Card>
      </AppShell>
    );
  }

  async function removeAccount(a: AccountInfo) {
    if (!confirm(`删除账户「${a.label}」？其下所有域名缓存与租借也会被清除。`)) return;
    try {
      await api(`/api/accounts/${a.id}`, { method: "DELETE" });
      clearCache();
      await reload();
    } catch (e: any) {
      alert(e?.message ?? "删除失败");
    }
  }

  async function syncAll() {
    setSyncing(true);
    try {
      const res = await api<{ results: { ok: boolean; label: string; count?: number; error?: string }[] }>(
        "/api/sync",
        { method: "POST" }
      );
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length) alert(`部分失败：\n${failed.map((f) => `${f.label}: ${f.error}`).join("\n")}`);
      clearCache();
      await reload();
    } catch (e: any) {
      alert(e?.message ?? "同步失败");
    } finally {
      setSyncing(false);
    }
  }

  const accounts = data?.accounts ?? [];

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-100">DNSHE 账户</h1>
          <p className="text-xs text-muted">管理多个 DNSHE API 凭证</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={syncAll} loading={syncing}>
            <RefreshCw className="h-3.5 w-3.5" /> 同步全部
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5" /> 添加账户
          </Button>
        </div>
      </div>

      {error && <Card className="mb-4 border-rose-500/40"><CardBody className="text-sm text-rose-300">{error}</CardBody></Card>}

      <Card>
        <CardBody className="p-0">
          {loading && !data ? (
            <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-brand" /></div>
          ) : accounts.length === 0 ? (
            <EmptyState title="还没有 DNSHE 账户" hint="点击「添加账户」填入 API Key 与 Secret" />
          ) : (
            <div className="divide-y divide-border">
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="text-sm text-slate-100">{a.label}</div>
                    <div className="text-xs text-muted">
                      {a.api_key} · 上次同步 {formatDate(a.last_synced_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" loading={reloading} onClick={() => void reload()}>
                      刷新
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeAccount(a)}>
                      <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {showAdd && (
        <AddAccountModal
          onClose={() => setShowAdd(false)}
          onDone={async () => {
            clearCache();
            await reload();
          }}
        />
      )}
    </AppShell>
  );
}

function AddAccountModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/accounts", {
        method: "POST",
        body: { label, api_key: apiKey, api_secret: apiSecret },
      });
      await onDone();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "添加失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="添加 DNSHE 账户">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>备注名称</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="主号 / 备用号" />
        </div>
        <div>
          <Label>API Key</Label>
          <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="cfsd_..." required />
        </div>
        <div>
          <Label>API Secret</Label>
          <Input
            type="password"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder="API Secret"
            required
          />
        </div>
        <p className="text-[11px] text-slate-500">
          凭证会用 AES-256-GCM 加密后存入 KV，绝不会下发到浏览器。添加时会自动测试连接并同步一次。
        </p>
        {err && <p className="text-xs text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={busy}>
            添加并测试
          </Button>
        </div>
      </form>
    </Modal>
  );
}
