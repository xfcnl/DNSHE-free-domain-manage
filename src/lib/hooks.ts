"use client";

import { useCallback, useEffect, useState } from "react";
import { api, readCacheEntry, writeCache } from "./api";

export interface QueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reloading: boolean;
  reload: () => Promise<void>;
}

// 缓存命中但超过该时长时，在后台重新验证
const REVALIDATE_AFTER = 30 * 1000;

export function useQuery<T = any>(path: string | null, ttl?: number): QueryResult<T> {
  const [data, setData] = useState<T | null>(() => (path ? readCacheEntry<T>(path)?.data ?? null : null));
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const load = useCallback(
    async (force = false) => {
      if (!path) return;
      const cached = force ? null : readCacheEntry<T>(path);
      if (cached) {
        setData(cached.data);
        setLoading(false);
      }
      // 缓存足够新且非强制刷新 → 直接用缓存，不发请求
      if (cached && !force && Date.now() - cached.t < REVALIDATE_AFTER) {
        return;
      }
      setReloading(true);
      try {
        const res = await api<T>(path);
        setData(res);
        writeCache(path, res, ttl);
        setError(null);
      } catch (e: any) {
        if (!cached) setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
        setReloading(false);
      }
    },
    [path, ttl]
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reloading, reload: () => load(true) };
}
