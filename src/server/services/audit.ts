import type { Ctx } from "../context";
import { newId } from "../storage/repos";
import type { AuditLog } from "../types";

export async function logAudit(
  ctx: Ctx,
  userId: string,
  action: string,
  target: string,
  detail: string
): Promise<void> {
  const entry: AuditLog = {
    id: newId(),
    user_id: userId,
    action,
    target,
    detail,
    created_at: ctx.now(),
  };
  try {
    await ctx.auditLogs.insert(entry);
  } catch {
    // 审计失败不应影响主流程
  }
}
