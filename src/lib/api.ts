// 生产环境同源 /api；开发环境默认指向本地 Worker（可用 NEXT_PUBLIC_API_BASE 覆盖）
function devApiBase(): string {
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8787`;
  }
  return "http://localhost:8787";
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  (process.env.NODE_ENV === "development" ? devApiBase() : "");

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("dnshe_token");
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem("dnshe_token", token);
  else window.localStorage.removeItem("dnshe_token");
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(
      `无法连接 API 服务（${API_BASE || "同源"}）。请确认后端已启动：npm run dev:all，或另开终端 npm run cf:dev`,
      0
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (data as any).error || `HTTP ${res.status}`,
      res.status,
      (data as any).error_code
    );
  }
  return data as T;
}

// ---------- 带 localStorage 缓存的查询 hook 数据源 ----------

const CACHE_PREFIX = "dnshe_cache:";
const DEFAULT_TTL = 5 * 60 * 1000;

export function readCache<T>(path: string): T | null {
  return readCacheEntry<T>(path)?.data ?? null;
}

export function readCacheEntry<T>(path: string): { data: T; t: number; ttl: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + path);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t: number; ttl: number; data: T };
    if (Date.now() - parsed.t > parsed.ttl) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache(path: string, data: unknown, ttl = DEFAULT_TTL): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_PREFIX + path, JSON.stringify({ t: Date.now(), ttl, data }));
  } catch {
    /* ignore */
  }
}

export function clearCache(prefix?: string): void {
  if (typeof window === "undefined") return;
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX + (prefix ?? ""))) keys.push(k);
  }
  keys.forEach((k) => window.localStorage.removeItem(k));
}
