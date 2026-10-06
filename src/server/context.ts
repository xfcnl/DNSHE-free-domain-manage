import { Collection } from "./storage/repos";
import type { Store } from "./storage/store";
import type { AuditLog, DnsheAccount, DnsRecord, Domain, Env, Rental, User } from "./types";

export interface Ctx {
  store: Store;
  env: Env;
  users: Collection<User>;
  accounts: Collection<DnsheAccount>;
  domains: Collection<Domain>;
  rentals: Collection<Rental>;
  dnsRecords: Collection<DnsRecord>;
  auditLogs: Collection<AuditLog>;
  waitUntil: (p: Promise<unknown>) => void;
  now: () => string;
}

export function createCtx(store: Store, env: Env, waitUntil?: (p: Promise<unknown>) => void): Ctx {
  return {
    store,
    env,
    users: new Collection<User>(store, "users"),
    accounts: new Collection<DnsheAccount>(store, "accounts"),
    domains: new Collection<Domain>(store, "domains"),
    rentals: new Collection<Rental>(store, "rentals"),
    dnsRecords: new Collection<DnsRecord>(store, "dns_records"),
    auditLogs: new Collection<AuditLog>(store, "audit_logs"),
    waitUntil: waitUntil ?? ((p) => void p),
    now: () => new Date().toISOString(),
  };
}
