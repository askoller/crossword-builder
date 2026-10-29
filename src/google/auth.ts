// Google Identity Services token client (SPEC §5.3), scope drive.file. No backend: the
// access token lives in memory and in IndexedDB (it lasts about an hour). Renewal is
// silent when Google allows it; otherwise backup pauses until Andrew taps to resume.
import { signal } from '@preact/signals';
import { DRIVE_SCOPE, GOOGLE_CLIENT_ID } from '../config';
import { getSetting, setSetting } from '../data/db';
import { loadScript } from './loader';

/** disconnected: never connected or signed out. paused: connected, but the token expired
 *  and could not be renewed without a tap. */
export type AuthState = 'disconnected' | 'connected' | 'paused';

export const authState = signal<AuthState>('disconnected');

interface StoredToken {
  token: string;
  /** Unix ms */
  expires: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

/** The part of google.accounts.oauth2 this app uses. */
export interface GisOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type?: string; message?: string }) => void;
  }): { requestAccessToken(o?: { prompt?: string }): void };
  revoke(token: string, done?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOAuth2 } };
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
/** Renew this long before the token runs out. */
const MARGIN_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const TOKEN_KEY = 'googleToken';
const CONNECTED_KEY = 'googleConnected';

let current: StoredToken | null = null;
let client: ReturnType<GisOAuth2['initTokenClient']> | null = null;
let pending: { resolve: (t: StoredToken) => void; reject: (e: Error) => void } | null = null;
let renewTimer: ReturnType<typeof setTimeout> | null = null;

export class AuthError extends Error {}

async function gis(): Promise<GisOAuth2> {
  if (!window.google?.accounts?.oauth2) await loadScript(GIS_SRC);
  const o = window.google?.accounts?.oauth2;
  if (!o) throw new AuthError('Google sign-in did not load');
  return o;
}

async function tokenClient() {
  if (client) return client;
  const o = await gis();
  client = o.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (r) => {
      const p = pending;
      pending = null;
      if (!p) return;
      if (r.error || !r.access_token) p.reject(new AuthError(r.error_description || r.error || 'Sign-in failed'));
      else p.resolve({ token: r.access_token, expires: Date.now() + Number(r.expires_in ?? 3600) * 1000 });
    },
    error_callback: (e) => {
      const p = pending;
      pending = null;
      p?.reject(new AuthError(e.message || e.type || 'Sign-in was closed'));
    },
  });
  return client;
}

async function request(prompt: '' | 'consent'): Promise<StoredToken> {
  const c = await tokenClient();
  pending?.reject(new AuthError('Superseded'));
  const t = await new Promise<StoredToken>((resolve, reject) => {
    pending = { resolve, reject };
    c.requestAccessToken({ prompt });
    // A popup left open must not hold up backups forever.
    setTimeout(() => {
      if (pending?.resolve !== resolve) return;
      pending = null;
      reject(new AuthError('Sign-in timed out'));
    }, REQUEST_TIMEOUT_MS);
  });
  await accept(t);
  return t;
}

async function accept(t: StoredToken): Promise<void> {
  current = t;
  authState.value = 'connected';
  await setSetting(TOKEN_KEY, t);
  await setSetting(CONNECTED_KEY, true);
  scheduleRenew();
}

function scheduleRenew(): void {
  if (renewTimer) clearTimeout(renewTimer);
  renewTimer = null;
  if (!current || typeof window === 'undefined') return;
  const wait = Math.max(0, current.expires - MARGIN_MS - Date.now());
  renewTimer = setTimeout(() => void getToken().catch(() => {}), wait);
}

function valid(t: StoredToken | null): t is StoredToken {
  return !!t && t.expires - MARGIN_MS > Date.now();
}

/** Restore the connection state on app start (no network, no popup). */
export async function initAuth(): Promise<void> {
  if (!(await getSetting<boolean>(CONNECTED_KEY))) {
    authState.value = 'disconnected';
    return;
  }
  const t = (await getSetting<StoredToken>(TOKEN_KEY)) ?? null;
  current = t;
  authState.value = valid(t) ? 'connected' : 'paused';
  scheduleRenew();
}

/** Connect from a tap in Settings: shows Google's consent popup. */
export async function connect(): Promise<void> {
  await request('consent');
}

/** Resume from a tap on "Backup paused": usually closes on its own without a prompt. */
export async function resume(): Promise<void> {
  await request('');
}

/**
 * A valid access token. Tries a silent renewal when the stored one is about to expire;
 * if Google needs a tap (popup blocked, consent), backup pauses and this throws.
 */
export async function getToken(): Promise<string> {
  if (authState.value === 'disconnected') throw new AuthError('Google Drive is not connected');
  if (valid(current)) return current.token;
  if (authState.value === 'paused') throw new AuthError('Backup paused');
  try {
    return (await request('')).token;
  } catch (e) {
    authState.value = 'paused';
    throw e instanceof AuthError ? e : new AuthError(String(e));
  }
}

/** Drive said the token is no longer good (401): forget it so the next call renews. */
export function invalidateToken(): void {
  if (current) current = { ...current, expires: 0 };
}

export async function disconnect(): Promise<void> {
  const t = current?.token;
  current = null;
  if (renewTimer) clearTimeout(renewTimer);
  renewTimer = null;
  authState.value = 'disconnected';
  await setSetting(CONNECTED_KEY, false);
  await setSetting(TOKEN_KEY, null);
  if (t) {
    try {
      (await gis()).revoke(t);
    } catch {
      // offline: the token expires on its own within the hour
    }
  }
}

/** Tests only. */
export function resetAuthForTests(): void {
  current = null;
  client = null;
  pending = null;
  if (renewTimer) clearTimeout(renewTimer);
  renewTimer = null;
  authState.value = 'disconnected';
}
