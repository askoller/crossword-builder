import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSetting } from '../../src/data/db';
import { authState, connect, disconnect, getToken, initAuth, resetAuthForTests, resume, type GisOAuth2 } from '../../src/google/auth';
import { resetDb } from './fakeDrive';

/** Mock google.accounts.oauth2: each request answers with the next queued response. */
function mockGis() {
  const responses: ({ access_token: string; expires_in: number } | { error: string } | 'popup_failed_to_open')[] = [];
  const prompts: string[] = [];
  const revoked: string[] = [];
  const oauth2: GisOAuth2 = {
    initTokenClient(cfg) {
      return {
        requestAccessToken(o) {
          prompts.push(o?.prompt ?? '');
          const r = responses.shift() ?? 'popup_failed_to_open';
          queueMicrotask(() => (r === 'popup_failed_to_open' ? cfg.error_callback?.({ type: r }) : cfg.callback(r)));
        },
      };
    },
    revoke(t, done) {
      revoked.push(t);
      done?.();
    },
  };
  window.google = { accounts: { oauth2 } };
  return { responses, prompts, revoked };
}

beforeEach(async () => {
  await resetDb();
  resetAuthForTests();
});
afterEach(() => {
  vi.useRealTimers();
  delete window.google;
});

describe('Google sign-in (token client, drive.file)', () => {
  it('connect asks for consent and stores the token', async () => {
    const g = mockGis();
    g.responses.push({ access_token: 'tok1', expires_in: 3600 });
    await connect();
    expect(g.prompts).toEqual(['consent']);
    expect(authState.value).toBe('connected');
    expect(await getToken()).toBe('tok1');
    expect(await getSetting('googleConnected')).toBe(true);
  });

  it('renews silently when the token is about to expire', async () => {
    const g = mockGis();
    g.responses.push({ access_token: 'short', expires_in: 60 }, { access_token: 'fresh', expires_in: 3600 });
    await connect();
    expect(await getToken()).toBe('fresh');
    expect(g.prompts).toEqual(['consent', '']);
  });

  it('pauses when silent renewal needs a tap, and resumes from one', async () => {
    const g = mockGis();
    g.responses.push({ access_token: 'short', expires_in: 60 }, 'popup_failed_to_open');
    await connect();
    await expect(getToken()).rejects.toThrow();
    expect(authState.value).toBe('paused');
    // while paused, no more popups are attempted in the background
    await expect(getToken()).rejects.toThrow(/paused/);
    expect(g.prompts).toHaveLength(2);
    g.responses.push({ access_token: 'again', expires_in: 3600 });
    await resume();
    expect(authState.value).toBe('connected');
    expect(await getToken()).toBe('again');
  });

  it('restores state on start without any network', async () => {
    const g = mockGis();
    g.responses.push({ access_token: 'tok', expires_in: 3600 });
    await connect();
    resetAuthForTests();
    await initAuth();
    expect(authState.value).toBe('connected');
    expect(await getToken()).toBe('tok');
    expect(g.prompts).toHaveLength(1);
  });

  it('an expired stored token starts paused', async () => {
    const g = mockGis();
    g.responses.push({ access_token: 'old', expires_in: 1 });
    await connect();
    resetAuthForTests();
    await initAuth();
    expect(authState.value).toBe('paused');
  });

  it('disconnect revokes and forgets', async () => {
    const g = mockGis();
    g.responses.push({ access_token: 'tok', expires_in: 3600 });
    await connect();
    await disconnect();
    expect(g.revoked).toEqual(['tok']);
    expect(authState.value).toBe('disconnected');
    resetAuthForTests();
    await initAuth();
    expect(authState.value).toBe('disconnected');
    await expect(getToken()).rejects.toThrow(/not connected/);
  });

  it('a refused consent leaves Drive disconnected', async () => {
    const g = mockGis();
    g.responses.push({ error: 'access_denied' });
    await expect(connect()).rejects.toThrow(/access_denied/);
    expect(authState.value).toBe('disconnected');
  });
});
