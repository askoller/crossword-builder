// Google mocked for the e2e tests: GIS token client stubbed in the page, Drive REST
// answered by an in-memory store via page.route. No real Google calls.
import type { Page, Route } from '@playwright/test';

export interface F {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  modifiedTime: string;
  body: Buffer<ArrayBufferLike>;
}

export async function mockGoogle(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { google: unknown }).google = {
      accounts: {
        oauth2: {
          initTokenClient(cfg: { callback: (r: unknown) => void }) {
            return { requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'e2e-token', expires_in: 3600 })) };
          },
          revoke() {},
        },
      },
    };
  });
  const files: F[] = [];
  let n = 0;
  const add = (meta: Partial<F>, body: Buffer<ArrayBufferLike> = Buffer.alloc(0)) => {
    const f = { id: `f${++n}`, name: '', mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), ...meta, body } as F;
    files.push(f);
    return f;
  };
  const meta = ({ body: _b, ...m }: F) => m;
  const multipart = (req: Buffer, type: string) => {
    const b = `--${type.split('boundary=')[1]}`;
    const text = req.toString('latin1');
    const second = text.indexOf(b, b.length);
    const m = JSON.parse(text.slice(text.indexOf('\r\n\r\n') + 4, second).trim());
    const start = text.indexOf('\r\n\r\n', second) + 4;
    return { m, body: req.subarray(start, text.lastIndexOf(`\r\n${b}--`)) };
  };
  await page.route('https://www.googleapis.com/**', async (route: Route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'GET' && u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q') ?? '';
      const name = q.match(/name = '([^']*)'/)?.[1];
      const parent = q.match(/'([^']*)' in parents/)?.[1];
      const tag = q.match(/key='puzzleId' and value='([^']*)'.*key='kind' and value='([^']*)'/);
      return json({
        files: files
          .filter((f) => (!name || f.name === name) && (!parent || f.parents?.includes(parent)) && (!tag || (f.appProperties?.puzzleId === tag[1] && f.appProperties?.kind === tag[2])))
          .filter((f) => !q.includes("name contains '.json'") || f.name.endsWith('.json'))
          .map(meta),
      });
    }
    const id = u.pathname.split('/').pop()!;
    if (req.method() === 'GET') {
      const f = files.find((x) => x.id === id);
      if (!f) return json({ error: { message: 'not found' } }, 404);
      return u.searchParams.get('alt') === 'media' ? route.fulfill({ body: f.body }) : json(meta(f));
    }
    if (req.method() === 'POST' && u.pathname === '/drive/v3/files') return json(meta(add(req.postDataJSON())));
    const { m, body } = multipart(req.postDataBuffer()!, req.headers()['content-type']);
    if (req.method() === 'POST') return json(meta(add(m, body)));
    const f = files.find((x) => x.id === id)!;
    Object.assign(f, m, { body, modifiedTime: new Date().toISOString() });
    return json(meta(f));
  });
  return files;
}
