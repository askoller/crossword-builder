// App-level state: route (hash based, so a reload reopens the same screen), layout mode.
import { signal } from '@preact/signals';

export type Route =
  | { name: 'home' }
  | { name: 'editor'; id: string }
  | { name: 'notebook' }
  | { name: 'clues' }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'puzzle' && b) return { name: 'editor', id: decodeURIComponent(b) };
  if (a === 'notebook' || a === 'clues' || a === 'settings') return { name: a };
  return { name: 'home' };
}

export function routeHash(r: Route): string {
  return r.name === 'editor' ? `#/puzzle/${encodeURIComponent(r.id)}` : r.name === 'home' ? '#/' : `#/${r.name}`;
}

export const route = signal<Route>(typeof location !== 'undefined' ? parseHash(location.hash) : { name: 'home' });

export function navigate(r: Route, replace = false): void {
  const h = routeHash(r);
  if (replace) history.replaceState(null, '', h);
  else if (location.hash !== h) history.pushState(null, '', h);
  route.value = r;
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => (route.value = parseHash(location.hash)));
  window.addEventListener('hashchange', () => (route.value = parseHash(location.hash)));
}

/** Inner screen (unfolded, landscape-ish) vs cover screen. Matches the CSS switch. */
export const WIDE_QUERY = '(min-aspect-ratio: 1/1), (min-width: 900px)';
const mq = typeof matchMedia !== 'undefined' ? matchMedia(WIDE_QUERY) : null;
export const wide = signal(mq?.matches ?? false);
mq?.addEventListener('change', (e) => (wide.value = e.matches));

/** Bumped after a data import so screens reload what they show. */
export const dataVersion = signal(0);

/** Set by the service worker registration when a new version is waiting. */
export const updateReady = signal<null | (() => void)>(null);
