"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Button, Card, CardBody, Input, Label } from "@/components/ui";

export default function LoginPage() {
  const { user, loading, login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(username, password);
      else await register(username, password);
      router.replace("/");
    } catch (err: any) {
      setError(err?.message ?? "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardBody>
          <div className="mb-5 text-center">
            <h1 className="text-lg font-bold text-slate-100">DNSHE 域名管理</h1>
            <p className="mt-1 text-xs text-muted">
              {mode === "login" ? "登录以管理你的免费域名" : "注册新账号"}
            </p>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label>用户名</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="用户名"
                autoComplete="username"
                required
              />
            </div>
            <div>
              <Label>密码</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
              />
            </div>

            {error && <p className="text-xs text-rose-400">{error}</p>}

            <Button type="submit" loading={busy} className="w-full">
              {mode === "login" ? "登录" : "注册"}
            </Button>
          </form>

          <div className="mt-4 text-center text-xs text-muted">
            {mode === "login" ? "还没有账号？" : "已有账号？"}
            <button
              className="ml-1 text-brand hover:underline"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
              }}
            >
              {mode === "login" ? "注册" : "登录"}
            </button>
          </div>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-500">
            若服务端配置了 <code>INITIAL_ADMIN_USERNAME</code> / <code>INITIAL_ADMIN_PASSWORD</code>，
            请直接用该账号登录；否则第一个注册的账号会自动成为管理员。
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
