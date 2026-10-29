// An in-memory Google Drive v3 behind a fake fetch, for the backup / sync / import tests.
// Understands just the queries and upload shapes src/google/drive.ts sends.
import { Drive, type DriveFile } from '../../src/google/drive';

interface Stored extends DriveFile {
  content: Uint8Array;
  trashed?: boolean;
}

export class FakeDrive {
  files = new Map<string, Stored>();
  calls: { method: string; url: string }[] = [];
  /** answer the next N requests with 401 */
  unauthorized = 0;
  private next = 1;
  readonly drive: Drive;
  invalidated = 0;

  constructor() {
    this.drive = new Drive(
      async () => 'token',
      () => this.invalidated++,
      (input, init) => this.fetch(String(input), init ?? {}),
    );
  }

  add(meta: Partial<DriveFile> & { name: string }, content: string | Uint8Array = ''): Stored {
    const id = `f${this.next++}`;
    const f: Stored = {
      id,
      mimeType: 'application/octet-stream',
      modifiedTime: new Date(Date.now() + this.next).toISOString(),
      ...meta,
      content: typeof content === 'string' ? new TextEncoder().encode(content) : content,
    };
    this.files.set(id, f);
    return f;
  }

  text(id: string): string {
    return new TextDecoder().decode(this.files.get(id)!.content);
  }

  byName(name: string): Stored[] {
    return [...this.files.values()].filter((f) => f.name === name && !f.trashed);
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  private meta(f: Stored): DriveFile {
    const { content: _c, trashed: _t, ...rest } = f;
    return rest;
  }

  private matches(f: Stored, query: string): boolean {
    const unq = (s: string) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    for (const raw of query.split(/ and (?![^{]*})/)) {
      const t = raw.trim();
      let m: RegExpMatchArray | null;
      if (t === 'trashed = false') {
        if (f.trashed) return false;
      } else if ((m = t.match(/^mimeType = '(.*)'$/))) {
        if (f.mimeType !== unq(m[1])) return false;
      } else if ((m = t.match(/^name = '(.*)'$/))) {
        if (f.name !== unq(m[1])) return false;
      } else if ((m = t.match(/^name contains '(.*)'$/))) {
        if (!f.name.includes(unq(m[1]))) return false;
      } else if ((m = t.match(/^'(.*)' in parents$/))) {
        if (!f.parents?.includes(unq(m[1]))) return false;
      } else if ((m = t.match(/^appProperties has \{ key='(.*)' and value='(.*)' \}$/))) {
        if (f.appProperties?.[unq(m[1])] !== unq(m[2])) return false;
      } else throw new Error(`fake drive: unknown query part ${t}`);
    }
    return true;
  }

  private async parseMultipart(body: Blob, type: string): Promise<{ meta: Record<string, unknown>; content: Uint8Array }> {
    const boundary = type.split('boundary=')[1];
    const bytes = new Uint8Array(await body.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    const parts = text.split(`--${boundary}`);
    const metaPart = parts[1];
    const meta = JSON.parse(metaPart.slice(metaPart.indexOf('\r\n\r\n') + 4).trim()) as Record<string, unknown>;
    // content: between the second part's blank line and the closing "\r\n--boundary--"
    const start = text.indexOf('\r\n\r\n', text.indexOf(`--${boundary}`, text.indexOf(`--${boundary}`) + 1)) + 4;
    const end = text.lastIndexOf(`\r\n--${boundary}--`);
    return { meta, content: bytes.slice(start, end) };
  }

  async fetch(url: string, init: RequestInit): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    this.calls.push({ method, url });
    if (this.unauthorized > 0) {
      this.unauthorized--;
      return this.json({ error: { message: 'Invalid Credentials' } }, 401);
    }
    const u = new URL(url);
    const path = u.pathname;
    if (method === 'GET' && path === '/drive/v3/files') {
      const files = [...this.files.values()].filter((f) => this.matches(f, u.searchParams.get('q') ?? ''));
      return this.json({ files: files.map((f) => this.meta(f)) });
    }
    let m = path.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m && method === 'GET') {
      const f = this.files.get(decodeURIComponent(m[1]));
      if (!f || f.trashed) return this.json({ error: { message: 'File not found' } }, 404);
      if (u.searchParams.get('alt') === 'media') return new Response(f.content as BlobPart);
      return this.json(this.meta(f));
    }
    if (method === 'POST' && path === '/drive/v3/files') {
      const meta = JSON.parse(String(init.body)) as Partial<DriveFile> & { name: string };
      return this.json(this.meta(this.add(meta)));
    }
    if (method === 'POST' && path === '/upload/drive/v3/files') {
      const { meta, content } = await this.parseMultipart(init.body as Blob, new Headers(init.headers).get('Content-Type')!);
      return this.json(this.meta(this.add(meta as unknown as DriveFile, content)));
    }
    m = path.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
    if (m && method === 'PATCH') {
      const f = this.files.get(decodeURIComponent(m[1]));
      if (!f || f.trashed) return this.json({ error: { message: 'File not found' } }, 404);
      const { meta, content } = await this.parseMultipart(init.body as Blob, new Headers(init.headers).get('Content-Type')!);
      Object.assign(f, meta, { content, modifiedTime: new Date(Date.now() + this.next++).toISOString() });
      return this.json(this.meta(f));
    }
    return this.json({ error: { message: `fake drive: ${method} ${path}` } }, 400);
  }
}

/** Fresh IndexedDB for each test. */
export async function resetDb(): Promise<void> {
  const { closeDb, DB_NAME } = await import('../../src/data/db');
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
