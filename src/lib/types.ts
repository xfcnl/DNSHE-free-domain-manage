export interface AccountInfo {
  id: string;
  label: string;
  api_key: string;
  last_synced_at: string | null;
  created_at: string;
}

export interface DomainRentalSummary {
  id: string;
  renter: string;
  prefix: string;
  scoped_domain: string;
  expires_at: string | null;
}

export interface DomainInfo {
  id: string;
  account_id: string;
  account_label: string | null;
  dnshe_subdomain_id: number;
  subdomain: string;
  rootdomain: string;
  full_domain: string;
  scoped_domain: string;
  status: string;
  expires_at: string | null;
  never_expires: number;
  self_service: boolean;
  renter: string | null;
  rental_id: string | null;
  rental_prefix: string;
  rental_expires_at: string | null;
  rentals: DomainRentalSummary[];
}

export interface SelfServiceDomain {
  id: string;
  full_domain: string;
  account_label: string | null;
  taken_prefixes: string[];
}

export interface RentalInfo {
  id: string;
  domain_id: string;
  renter_user_id: string;
  rented_by: string;
  rented_at: string;
  expires_at: string | null;
  status: string;
  prefix: string;
  notes: string;
  renter: string;
  rented_by_name: string;
}

export interface Stats {
  domains: number;
  active: number;
  expiringSoon: number;
  accounts: number;
  users: number;
  rentals: number;
}

export interface Bootstrap {
  user: { id: string; username: string; role: "admin" | "user"; created_at: string };
  accounts: AccountInfo[];
  domains: DomainInfo[];
  rentals: RentalInfo[];
  self_service: SelfServiceDomain[];
  stats: Stats;
  syncing: boolean;
}

export interface DnsRecordInfo {
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

export interface AuditInfo {
  id: string;
  user_id: string;
  action: string;
  target: string;
  detail: string;
  created_at: string;
}
