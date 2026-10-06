"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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
import { formatDate } from "@/lib/format";

interface AdminUser {
  id: string;
  username: string;
  role: "admin" | "user";
  created_at: string;
}

export default function AdminUsersPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useQuery<{ users: AdminUser[] }>("/api/admin/users");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  if (user && user.role !== "admin") {
    return (
      <AppShell>
        <Card><CardBody className="text-sm text-rose-300">需要管理员权限</CardBody></Card>
      </AppShell>
    );
  }

  async function toggleRole(u: AdminUser) {
    setBusyId(u.id);
    try {
      await api(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        body: { role: u.role === "admin" ? "user" : "admin" },
      });
      clearCache();
      await reload();
    } catch (e: any) {
      alert(e?.message ?? "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(u: AdminUser) {
    if (!confirm(`删除用户 ${u.username}？其租借会被回收。`)) return;
    setBusyId(u.id);
    try {
      await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
      clearCache();
      await reload();
    } catch (e: any) {
      alert(e?.message ?? "删除失败");
    } finally {
      setBusyId(null);
    }
  }

  const users = data?.users ?? [];

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-100">用户管理</h1>
          <p className="text-xs text-muted">共 {users.length} 个用户</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5" /> 创建用户
        </Button>
      </div>

      {error && <Card className="mb-4 border-rose-500/40"><CardBody className="text-sm text-rose-300">{error}</CardBody></Card>}

      <Card>
        <CardBody className="p-0">
          {loading && !data ? (
            <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-brand" /></div>
          ) : users.length === 0 ? (
            <EmptyState title="暂无用户" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">用户名</th>
                    <th className="px-4 py-2 font-medium">角色</th>
                    <th className="px-4 py-2 font-medium">注册时间</th>
                    <th className="px-4 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5 text-slate-100">
                        {u.username}
                        {u.id === user?.id && <span className="ml-2 text-xs text-muted">(你)</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          className={
                            u.role === "admin"
                              ? "border-brand/40 bg-brand/10 text-brand"
                              : "border-slate-500/30 bg-slate-500/10 text-slate-300"
                          }
                        >
                          {u.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted">{formatDate(u.created_at)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busyId === u.id}
                            disabled={u.id === user?.id}
                            onClick={() => toggleRole(u)}
                          >
                            {u.role === "admin" ? "降为用户" : "升为管理员"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busyId === u.id}
                            disabled={u.id === user?.id}
                            onClick={() => remove(u)}
                          >
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

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onDone={async () => {
            clearCache();
            await reload();
          }}
        />
      )}
    </AppShell>
  );
}

function CreateUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: { username: username.trim(), password, role },
      });
      await onDone();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="创建用户">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>用户名</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用户名" required />
        </div>
        <div>
          <Label>密码</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 6 位"
            required
          />
        </div>
        <div>
          <Label>角色</Label>
          <Select value={role} onChange={(e) => setRole(e.target.value as "user" | "admin")}>
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </Select>
        </div>
        <p className="text-[11px] text-slate-500">
          由管理员直接创建，无需用户自行注册。把账号密码告知对方即可登录。
        </p>
        {err && <p className="text-xs text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={busy}>
            创建
          </Button>
        </div>
      </form>
    </Modal>
  );
}
