import { createApp } from "../src/server/app";
import { CfStore } from "../src/server/storage/adapters";
import { createCtx } from "../src/server/context";
import { syncAll } from "../src/server/services/sync";
import type { Env } from "../src/server/types";

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const store = new CfStore(env.DNSHE_KV);
    const app = createApp(store, env, { waitUntil: (p) => ctx.waitUntil(p) });
    return app.fetch(request, env, ctx);
  },

  async scheduled(_event: any, env: Env, ctx: any): Promise<void> {
    const store = new CfStore(env.DNSHE_KV);
    const appCtx = createCtx(store, env);
    ctx.waitUntil(syncAll(appCtx).then(() => undefined));
  },
};
