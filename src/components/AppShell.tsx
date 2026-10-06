"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Share2,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Spinner, cn } from "./ui";

const NAV = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/domains", label: "域名", icon: Globe },
  { href: "/rentals", label: "租借", icon: Share2 },
  { href: "/accounts", label: "DNSHE 账户", icon: KeyRound, admin: true },
  { href: "/admin/users", label: "用户", icon: Users, admin: true },
  { href: "/admin/audit", label: "审计日志", icon: ScrollText, admin: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="h-6 w-6 text-brand" />
      </div>
    );
  }
  if (!user) return null;

  const items = NAV.filter((n) => !n.admin || user.role === "admin");

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-panel/50 p-3 md:flex">
        <div className="mb-6 px-2 pt-2">
          <div className="text-sm font-bold text-slate-100">DNSHE 域名管理</div>
          <div className="text-xs text-muted">多账户 · 租借 · DNS</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {items.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                  active ? "bg-brand/15 text-brand" : "text-slate-300 hover:bg-white/5"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border pt-3">
          <div className="px-3 py-1 text-xs text-muted">
            {user.username} · {user.role === "admin" ? "管理员" : "用户"}
          </div>
          <button
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <span className="text-sm font-bold">DNSHE 域名管理</span>
          <button
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            className="text-xs text-muted"
          >
            退出
          </button>
        </header>
        <main className="mx-auto max-w-6xl p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
