// Load Google's browser scripts on demand. They are only needed for Drive, so the
// editing path never waits on them (CLAUDE.md rule 3).
const loading = new Map<string, Promise<void>>();

export function loadScript(src: string): Promise<void> {
  let p = loading.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        loading.delete(src);
        reject(new Error(navigator.onLine ? `Could not load ${src}` : 'You are offline'));
      };
      document.head.appendChild(s);
    });
    loading.set(src, p);
  }
  return p;
}
