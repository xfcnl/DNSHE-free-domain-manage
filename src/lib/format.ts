export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-CN", { hour12: false });
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("zh-CN");
}

export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / (24 * 3600 * 1000));
}

export function expiryLabel(expiresAt: string | null, neverExpires: number): string {
  if (neverExpires) return "永久";
  if (!expiresAt) return "—";
  const days = daysUntil(expiresAt);
  if (days === null) return formatDay(expiresAt);
  if (days < 0) return `已过期 ${-days} 天`;
  return `${formatDay(expiresAt)}（${days} 天）`;
}

export function statusColor(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "suspended":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "expired":
      return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    default:
      return "bg-slate-500/15 text-slate-300 border-slate-500/30";
  }
}
