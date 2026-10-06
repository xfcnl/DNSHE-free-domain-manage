import type { Store } from "./store";

/** Cloudflare KV 适配器（env.DNSHE_KV 绑定） */
export class CfStore implements Store {
  constructor(private kv: any) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    const v = await this.kv.get(key, "json");
    return (v ?? null) as T | null;
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.kv.put(key, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.kv.list({ prefix, cursor });
      for (const k of res.keys) keys.push(k.name);
      cursor = res.list_complete ? undefined : res.cursor;
    } while (cursor);
    return keys;
  }
}

/**
 * EdgeOne KV 适配器（env.DNSHE_KV 命名空间）。
 * EdgeOne 的 get 签名是 get(key, {type})，list 返回 keys[].key / complete，
 * 这里统一转换成 Store 的形状。
 */
export class EoStore implements Store {
  constructor(private kv: any) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    const v = await this.kv.get(key, { type: "json" });
    return (v ?? null) as T | null;
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.kv.put(key, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.kv.list({ prefix, cursor, limit: 256 });
      for (const k of res.keys) keys.push(k.key ?? k.name);
      cursor = res.complete ? undefined : res.cursor;
    } while (cursor);
    return keys;
  }
}
