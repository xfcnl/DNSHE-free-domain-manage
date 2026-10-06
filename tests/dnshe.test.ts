import { describe, it, expect } from "vitest";
import { normalizeStatus, normalizeDnsheError } from "../src/server/services/dnshe";

describe("DNSHE 字段/错误归一化", () => {
  it("normalizeStatus 把 Registered 归一为 active", () => {
    expect(normalizeStatus("Registered")).toBe("active");
    expect(normalizeStatus("active")).toBe("active");
    expect(normalizeStatus("Suspended")).toBe("suspended");
    expect(normalizeStatus("expired")).toBe("expired");
  });

  it("外部 nameservers 报错转成中文并带 error_code", () => {
    const r = normalizeDnsheError(
      "Domain is delegated to external nameservers. Switch back to the platform nameservers before modifying DNS records."
    );
    expect(r.error_code).toBe("external_nameservers");
    expect(r.error).toContain("外部 DNS");
  });

  it("其它错误原样透传", () => {
    const r = normalizeDnsheError("some error", "bad_request");
    expect(r.error).toBe("some error");
    expect(r.error_code).toBe("bad_request");
  });

  it("余额不足报错转成中文", () => {
    const r = normalizeDnsheError("insufficient balance for redemption renewal");
    expect(r.error_code).toBe("insufficient_balance");
  });
});
