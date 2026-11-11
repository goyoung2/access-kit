export interface Env {
  AUTH_PROVIDER?: 'firebase';
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_API_KEY?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  FIREBASE_APP_ID?: string;
  DB: D1Database;
  AUTH_ORIGIN: string;
  COOKIE_SECURE?: string;
  /** Private server-derived diagnostic rate key; never an authorization decision. */
  DIAGNOSTIC_NETWORK_KEY?: string;
}

export interface ApplicationRow {
  client_id: string;
  name: string;
  redirect_uris: string;
  status: string;
}

export interface OAuthRequestRow {
  diagnostic_ref?: string | null;
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  client_state: string | null;
  expires_at: number;
  created_at: number;
}

export interface SessionRow {
  user_id: string;
  expires_at: number;
}

export interface UserRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  status: string;
}

export interface MembershipRow {
  user_id: string;
  guild_id: string;
  is_guild_member: number;
  role: 'user' | 'member' | 'admin';
  status: 'active' | 'inactive';
  checked_at: number;
}
