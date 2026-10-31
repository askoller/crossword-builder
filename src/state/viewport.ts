// Sizes the app to the visible viewport and picks the layout (SPEC §3.10).
//
// `interactive-widget=resizes-content` (index.html) makes Chrome on Android shrink the
// layout viewport when the keyboard opens; `visualViewport` covers browsers that only
// shrink the visual viewport. `#app` and overlays are sized from `--app-h` / `--vv-top`,
// so nothing is ever laid out under the keyboard, and a focused text field is scrolled
// into view above it.
import { ViewportTracker, KEYBOARD_CLOSE_GRACE_MS } from '../model/layout';
import { keyboardOpen, layout } from './app';

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'range', 'file', 'button', 'submit', 'reset', 'color', 'image', 'hidden']);

/** A focused element that brings up the system keyboard. */
export function editableElement(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el.inputMode === 'none') return null;
  if (el instanceof HTMLTextAreaElement) return el.readOnly ? null : el;
  if (el instanceof HTMLInputElement) return NON_TEXT_INPUTS.has(el.type) || el.readOnly ? null : el;
  return el.isContentEditable ? el : null;
}

/** Scroll the focused text field into view inside its scrolling container. */
export function revealFocused(): void {
  const el = editableElement(document.activeElement);
  if (!el || el.closest('[data-pinned-editor]')) return;
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

let installed = false;

export function installViewport(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const tracker = new ViewportTracker();
  const root = document.documentElement;
  const vv = window.visualViewport;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const measure = () => {
    const scale = vv?.scale ?? 1;
    const zoomed = Math.abs(scale - 1) > 0.01;
    const h = vv && !zoomed ? vv.height : window.innerHeight;
    const st = tracker.update(window.innerWidth, h, !!editableElement(document.activeElement));
    root.style.setProperty('--app-h', `${Math.round(h)}px`);
    root.style.setProperty('--vv-top', `${Math.round(vv && !zoomed ? vv.offsetTop : 0)}px`);
    root.style.setProperty('--kb-h', `${Math.round(st.keyboardHeight)}px`);
    root.classList.toggle('kb-open', st.keyboardOpen);
    if (layout.peek() !== st.layout) layout.value = st.layout;
    if (keyboardOpen.peek() !== st.keyboardOpen) keyboardOpen.value = st.keyboardOpen;
    root.dataset.layout = st.layout;
  };
  const scheduleReveal = (ms: number) => setTimeout(() => requestAnimationFrame(revealFocused), ms);
  const onResize = () => {
    measure();
    scheduleReveal(30);
  };

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  vv?.addEventListener('resize', onResize);
  vv?.addEventListener('scroll', measure);
  document.addEventListener('focusin', () => {
    if (closeTimer) clearTimeout(closeTimer);
    measure();
    // the keyboard animates in; reveal again once it has settled
    scheduleReveal(60);
    scheduleReveal(350);
  });
  document.addEventListener('focusout', () => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(measure, KEYBOARD_CLOSE_GRACE_MS + 50);
  });
  measure();
}
