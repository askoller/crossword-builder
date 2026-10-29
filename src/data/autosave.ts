// Debounced saving: write 300 ms after the last change, and right away when the page is
// hidden or unloaded (CLAUDE.md rule 4).

export const AUTOSAVE_DELAY_MS = 300;

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export class Autosaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private dirty = false;
  private detach: (() => void) | null = null;

  constructor(
    private readonly save: () => Promise<void>,
    private readonly onState: (s: SaveState) => void = () => {},
    private readonly delay = AUTOSAVE_DELAY_MS,
  ) {}

  /** Mark the document changed; saves after the debounce delay. */
  schedule(): void {
    this.dirty = true;
    this.onState('pending');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  /** Save now if anything is pending. Resolves when the data is written. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) await this.running;
    if (!this.dirty) return;
    this.dirty = false;
    this.onState('saving');
    this.running = this.save()
      .then(() => this.onState(this.dirty ? 'pending' : 'saved'))
      .catch((e) => {
        console.error('autosave failed', e);
        this.dirty = true;
        this.onState('error');
      })
      .finally(() => {
        this.running = null;
      });
    await this.running;
  }

  get pending(): boolean {
    return this.dirty;
  }

  /** Flush on visibilitychange → hidden and on pagehide. */
  attach(win: Window = window): void {
    this.detach?.();
    const onVisibility = () => {
      if (win.document.visibilityState === 'hidden') void this.flush();
    };
    const onPageHide = () => void this.flush();
    win.document.addEventListener('visibilitychange', onVisibility);
    win.addEventListener('pagehide', onPageHide);
    this.detach = () => {
      win.document.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('pagehide', onPageHide);
    };
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
