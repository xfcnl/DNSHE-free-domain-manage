import type { Store } from "./store";

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  const bytes = c!.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 集合仓储，建立在 Store 之上。
 * - 记录键：`{name}_{id}`（只用字母/数字/下划线，满足 EdgeOne KV 的 key 限制）
 * - 索引键：`idx_{name}` 保存 id 列表，避免每次列表都调用 list()
 */
export class Collection<T extends { id: string }> {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private store: Store, public readonly name: string) {}

  /** 串行化索引变更，避免并发读改写导致丢条目 */
  private lock<R>(fn: () => Promise<R>): Promise<R> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private recKey(id: string): string {
    return `${this.name}_${id}`;
  }

  private idxKey(): string {
    return `idx_${this.name}`;
  }

  async get(id: string): Promise<T | null> {
    return this.store.get<T>(this.recKey(id));
  }

  async ids(): Promise<string[]> {
    return (await this.store.get<string[]>(this.idxKey())) ?? [];
  }

  async all(): Promise<T[]> {
    const ids = await this.ids();
    const items = await Promise.all(ids.map((id) => this.get(id)));
    const out: T[] = [];
    for (const item of items) {
      if (item) out.push(item);
    }
    return out;
  }

  async insert(item: T): Promise<T> {
    return this.lock(async () => {
      await this.store.put(this.recKey(item.id), item);
      const ids = await this.ids();
      if (!ids.includes(item.id)) {
        ids.push(item.id);
        await this.store.put(this.idxKey(), ids);
      }
      return item;
    });
  }

  async update(id: string, patch: Partial<T>): Promise<T | null> {
    const current = await this.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, id } as T;
    await this.store.put(this.recKey(id), next);
    return next;
  }

  async remove(id: string): Promise<boolean> {
    return this.lock(async () => {
      const current = await this.get(id);
      if (!current) return false;
      await this.store.del(this.recKey(id));
      const ids = await this.ids();
      await this.store.put(
        this.idxKey(),
        ids.filter((x) => x !== id)
      );
      return true;
    });
  }

  /** 批量写入（不改索引），用于同步回写 */
  async putMany(items: T[]): Promise<void> {
    await Promise.all(items.map((item) => this.store.put(this.recKey(item.id), item)));
  }

  async ensureIndexed(ids: string[]): Promise<void> {
    return this.lock(async () => {
      const current = await this.ids();
      const set = new Set(current);
      let changed = false;
      for (const id of ids) {
        if (!set.has(id)) {
          set.add(id);
          changed = true;
        }
      }
      if (changed) await this.store.put(this.idxKey(), Array.from(set));
    });
  }
}
