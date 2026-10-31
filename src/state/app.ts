// App-level state: route (hash based, so a reload reopens the same screen), layout mode.
import { computed, signal } from '@preact/signals';
import { chooseLayout, type Layout } from '../model/layout';

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

/**
 * Layout for the current viewport (SPEC §3.10): cover portrait, inner landscape, inner
 * portrait or the tall-phone fallback. Kept up to date by `installViewport()`
 * (`src/state/viewport.ts`) on resize, rotation, fold / unfold and the Android keyboard.
 */
export const layout = signal<Layout>(typeof window !== 'undefined' ? chooseLayout(window.innerWidth, window.innerHeight) : 'cover');
/** The Android keyboard is open (a text field has focus and the viewport shrank). */
export const keyboardOpen = signal(false);
/** Inner screen in landscape: grid + keyboard left, tools + panel right. */
export const wide = computed(() => layout.value === 'inner-landscape');

/** Bumped after a data import so screens reload what they show. */
export const dataVersion = signal(0);

/** Set by the service worker registration when a new version is waiting. */
export const updateReady = signal<null | (() => void)>(null);
