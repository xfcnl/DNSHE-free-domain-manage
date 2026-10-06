/**
 * 归一化后的键值存储接口。
 * Cloudflare KV 与 EdgeOne KV 都通过适配器实现这个接口，
 * 业务层只依赖 Store，不感知平台差异。
 */
export interface Store {
  get<T = unknown>(key: string): Promise<T | null>;
  put(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  /** 返回所有以 prefix 开头的 key（自动分页聚合） */
  list(prefix: string): Promise<string[]>;
}
