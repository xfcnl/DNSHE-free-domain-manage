export type Role = "admin" | "user";

export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  created_at: string;
}

export interface DnsheAccount {
  id: string;
  label: string;
  api_key: string;
  api_secret_enc: string;
  last_synced_at: string | null;
  created_at: string;
}

export interface Domain {
  id: string;
  account_id: string;
  dnshe_subdomain_id: number;
  subdomain: string;
  rootdomain: string;
  full_domain: string;
  status: string;
  expires_at: string | null;
  never_expires: number;
  /** 是否允许普通用户自助申请其下的子域名 */
  self_service?: boolean;
  created_at: string;
  updated_at: string;
}

export type RentalStatus = "active" | "revoked" | "expired";

export interface Rental {
  id: string;
  domain_id: string;
  renter_user_id: string;
  rented_by: string;
  rented_at: string;
  expires_at: string | null;
  status: RentalStatus;
  /** 子域名前缀（如 "11"）；为空表示租借整个域名 */
  prefix: string;
  notes: string;
}

export interface DnsRecord {
  id: string;
  domain_id: string;
  dnshe_record_id: string | null;
  name: string;
  type: string;
  content: string;
  ttl: number;
  priority: number | null;
  proxied: boolean;
  status: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  target: string;
  detail: string;
  created_at: string;
}

export interface Env {
  DNSHE_KV: unknown;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  INITIAL_ADMIN_USERNAME?: string;
  INITIAL_ADMIN_PASSWORD?: string;
  DNSHE_API_BASE?: string;
  CRON_TOKEN?: string;
}
