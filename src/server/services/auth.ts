import type { Ctx } from "../context";
import { newId } from "../storage/repos";
import type { Role, User } from "../types";
import { hashPassword, verifyPassword } from "../lib/crypto";

export async function findUserByUsername(ctx: Ctx, username: string): Promise<User | null> {
  const users = await ctx.users.all();
  const lower = username.trim().toLowerCase();
  return users.find((u) => u.username.toLowerCase() === lower) ?? null;
}

export async function findUserById(ctx: Ctx, id: string): Promise<User | null> {
  return ctx.users.get(id);
}

export async function countUsers(ctx: Ctx): Promise<number> {
  return (await ctx.users.ids()).length;
}

export async function createUser(
  ctx: Ctx,
  username: string,
  password: string,
  role: Role
): Promise<User> {
  const user: User = {
    id: newId(),
    username: username.trim(),
    password_hash: await hashPassword(password),
    role,
    created_at: ctx.now(),
  };
  await ctx.users.insert(user);
  return user;
}

/** 首次部署时按环境变量创建管理员；若没有配置则首个注册用户成为管理员 */
export async function ensureSeedAdmin(ctx: Ctx): Promise<void> {
  if ((await countUsers(ctx)) > 0) return;
  const username = ctx.env.INITIAL_ADMIN_USERNAME;
  const password = ctx.env.INITIAL_ADMIN_PASSWORD;
  if (username && password) {
    await createUser(ctx, username, password, "admin");
  }
}

export async function authenticate(
  ctx: Ctx,
  username: string,
  password: string
): Promise<User | null> {
  const user = await findUserByUsername(ctx, username);
  if (!user) return null;
  const ok = await verifyPassword(password, user.password_hash);
  return ok ? user : null;
}

export function publicUser(user: User) {
  return { id: user.id, username: user.username, role: user.role, created_at: user.created_at };
}
