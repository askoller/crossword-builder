// Layout choice from the real viewport (pure; no DOM). SPEC §3.10.
//
// The Fold 8 has three shapes: the cover screen (about 10:16 portrait), the inner screen
// in landscape (about 4:3) and the inner screen held in portrait (about 3:4). A normal
// phone (412 × 915, about 9:20) is the fallback. The Android keyboard shrinks the
// viewport height but not its width, so the layout is chosen from the height the
// viewport had before the keyboard opened.

export type Layout = 'cover' | 'inner-landscape' | 'inner-portrait' | 'phone';

/** Portrait viewports at least this wide (CSS px) are the inner screen held upright. */
export const INNER_PORTRAIT_MIN_WIDTH = 600;
/** Portrait viewports narrower than this aspect (w/h) are a normal tall phone. */
export const PHONE_MAX_ASPECT = 0.55;

export function chooseLayout(width: number, height: number): Layout {
  if (!(width > 0) || !(height > 0)) return 'cover';
  if (width >= height) return 'inner-landscape';
  if (width >= INNER_PORTRAIT_MIN_WIDTH) return 'inner-portrait';
  return width / height < PHONE_MAX_ASPECT ? 'phone' : 'cover';
}

export interface ViewportState {
  layout: Layout;
  /** the on-screen keyboard covers the bottom of the screen */
  keyboardOpen: boolean;
  /** CSS px the keyboard takes (0 when closed) */
  keyboardHeight: number;
  /** height before the keyboard opened, used for the layout */
  fullHeight: number;
}

/** The keyboard is open when the height dropped by more than this (px, or share of the height). */
const KEYBOARD_MIN_PX = 120;
const KEYBOARD_MIN_SHARE = 0.15;

/** After a text field loses focus the keyboard takes a moment to close; keep the full height meanwhile. */
export const KEYBOARD_CLOSE_GRACE_MS = 1000;

/**
 * Remembers the viewport height without the keyboard. While a text field has focus a
 * shorter viewport of the same width means the keyboard is open. A width change
 * (rotation, fold / unfold) or a shorter viewport with no text field focused (after the
 * keyboard had time to close) makes the current size the full size.
 */
export class ViewportTracker {
  private width = -1;
  private full = 0;
  private lastEditing = -Infinity;

  update(width: number, height: number, editing: boolean, now = Date.now()): ViewportState {
    if (editing) this.lastEditing = now;
    const sameWidth = Math.abs(width - this.width) <= 1;
    const closing = now - this.lastEditing < KEYBOARD_CLOSE_GRACE_MS;
    if (!sameWidth || height > this.full || (!editing && !closing)) this.full = height;
    this.width = width;
    const drop = this.full - height;
    const keyboardOpen = (editing || closing) && drop > Math.max(KEYBOARD_MIN_PX, this.full * KEYBOARD_MIN_SHARE);
    return {
      layout: chooseLayout(width, this.full),
      keyboardOpen,
      keyboardHeight: keyboardOpen ? drop : 0,
      fullHeight: this.full,
    };
  }
}
