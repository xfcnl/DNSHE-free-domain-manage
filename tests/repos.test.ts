import { describe, it, expect } from "vitest";
import { MemoryStore } from "./helpers";
import { Collection, newId } from "../src/server/storage/repos";

interface Item {
  id: string;
  name: string;
}

describe("Collection 仓储", () => {
  it("插入 / 读取 / 更新 / 删除 + 索引维护", async () => {
    const store = new MemoryStore();
    const col = new Collection<Item>(store, "items");

    const a = { id: newId(), name: "a" };
    const b = { id: newId(), name: "b" };
    await col.insert(a);
    await col.insert(b);

    expect((await col.all()).length).toBe(2);
    expect((await col.get(a.id))?.name).toBe("a");

    await col.update(a.id, { name: "a2" });
    expect((await col.get(a.id))?.name).toBe("a2");

    await col.remove(b.id);
    expect((await col.all()).length).toBe(1);
    expect(await col.get(b.id)).toBeNull();
  });

  it("putMany 不建索引，ensureIndexed 补索引", async () => {
    const store = new MemoryStore();
    const col = new Collection<Item>(store, "items");
    const items = [
      { id: newId(), name: "x" },
      { id: newId(), name: "y" },
    ];

    await col.putMany(items);
    expect((await col.all()).length).toBe(0);

    await col.ensureIndexed(items.map((i) => i.id));
    expect((await col.all()).length).toBe(2);

    // 重复 ensureIndexed 不应产生重复
    await col.ensureIndexed(items.map((i) => i.id));
    expect((await col.ids()).length).toBe(2);
  });
});
