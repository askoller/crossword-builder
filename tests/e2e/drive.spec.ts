// Google Drive flows with Google mocked: GIS token client stubbed in the page, Drive REST
// answered by an in-memory store via page.route. No real Google calls.
import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png` });

interface F {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  modifiedTime: string;
  body: Buffer<ArrayBufferLike>;
}

async function mockGoogle(page: Page) {
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

test('connect Drive, choose folder, back up, export .puz', async ({ page }) => {
  const files = await mockGoogle(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'New puzzle' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Drive grid');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.keyboard.type('crab');

  // .puz export from the overflow menu
  await page.getByRole('button', { name: 'More' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Export \.puz/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^drive-grid-[0-9a-f]{8}\.puz$/);
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(2, 13).toString('latin1')).toBe('ACROSS&DOWN');
  expect(bytes[0x2c]).toBe(15);

  await page.getByRole('button', { name: 'Back to puzzles' }).click();
  await expect(page.getByText('Not backed up yet')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.evaluate(() => document.fonts.ready);
  await shot(page, 'settings-drive-disconnected');

  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(page.getByRole('button', { name: 'Create new folder' })).toBeVisible();
  await shot(page, 'settings-drive-choose-folder');
  await page.getByRole('button', { name: 'Create new folder' }).click();
  await expect(page.getByRole('button', { name: 'Back up now' })).toBeVisible();
  await expect(page.getByText(/Last backup/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import data pack from Google Drive' })).toBeVisible();
  await shot(page, 'settings-drive-connected');

  expect(files.filter((f) => f.name === 'Crossword Builder')).toHaveLength(1);
  expect(files.some((f) => /^drive-grid-.*\.json$/.test(f.name))).toBe(true);
  expect(files.some((f) => /^drive-grid-.*\.puz$/.test(f.name))).toBe(true);
  expect(files.some((f) => f.name === 'notebook.json')).toBe(true);

  await page.getByRole('button', { name: 'Restore from Drive' }).click();
  await expect(page.getByRole('button', { name: 'Restore all 1' })).toBeVisible();
  await shot(page, 'settings-drive-restore');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Puzzles' }).click();
  await expect(page.getByText('Backed up to Google Drive')).toBeVisible();
  await shot(page, 'home-backed-up');
});
