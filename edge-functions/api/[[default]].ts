import { createApp } from "../../src/server/app";
import { EoStore } from "../../src/server/storage/adapters";
import type { Env } from "../../src/server/types";

/**
 * EdgeOne Edge Functions 入口。
 * 路由：/edge-functions/api/[[default]].ts → /api/*
 * KV 命名空间需在 EdgeOne 控制台绑定，运行时变量名设为 DNSHE_KV。
 */
export default function onRequest(context: any): Response | Promise<Response> {
  const env = context.env as Env;
  const store = new EoStore(env.DNSHE_KV);
  const app = createApp(store, env, {
    waitUntil: (p) => context.waitUntil?.(p),
  });
  return app.fetch(context.request, env, context);
}
