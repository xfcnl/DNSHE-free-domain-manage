import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  signJwt,
  verifyJwt,
  encryptSecret,
  decryptSecret,
  randomId,
} from "../src/server/lib/crypto";

describe("crypto", () => {
  it("randomId 只含小写字母数字", () => {
    const id = randomId();
    expect(id).toMatch(/^[a-z0-9]+$/);
    expect(id.length).toBeGreaterThanOrEqual(16);
  });

  it("PBKDF2 密码哈希与校验", async () => {
    const hash = await hashPassword("secret123");
    expect(hash.startsWith("pbkdf2$")).toBe(true);
    expect(await verifyPassword("secret123", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("JWT 签发、校验、防篡改", async () => {
    const token = await signJwt(
      { sub: "u1", role: "admin", iat: 1, exp: Math.floor(Date.now() / 1000) + 60 },
      "s"
    );
    const payload = await verifyJwt(token, "s");
    expect(payload?.sub).toBe("u1");
    expect(payload?.role).toBe("admin");
    expect(await verifyJwt(token, "other-secret")).toBeNull();
    expect(await verifyJwt(token.slice(0, -3) + "abc", "s")).toBeNull();
  });

  it("过期 JWT 被拒绝", async () => {
    const token = await signJwt({ sub: "u1", role: "user", iat: 1, exp: 1 }, "s");
    expect(await verifyJwt(token, "s")).toBeNull();
  });

  it("AES-256-GCM 加解密往返", async () => {
    const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    const enc = await encryptSecret("cfsd_super_secret", key);
    expect(enc).not.toContain("cfsd_super_secret");
    expect(await decryptSecret(enc, key)).toBe("cfsd_super_secret");
  });
});
