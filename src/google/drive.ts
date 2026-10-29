// Minimal Google Drive v3 REST client (fetch only, no gapi). With the drive.file scope it
// sees only files this app created or that Andrew picked in the Picker.
import { AuthError, getToken, invalidateToken } from './auth';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FIELDS = 'id,name,mimeType,modifiedTime,size,parents,appProperties';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
}

export interface FileMeta {
  name?: string;
  mimeType?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
}

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Quote a value for a Drive search query. */
export function q(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export class Drive {
  constructor(
    private readonly token: () => Promise<string> = getToken,
    private readonly onUnauthorized: () => void = invalidateToken,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async call(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await this.token()}`);
    const res = await this.fetchFn(url, { ...init, headers });
    if (res.status === 401 && retry) {
      this.onUnauthorized();
      return this.call(url, init, false);
    }
    if (res.status === 401) throw new AuthError('Google Drive sign-in expired');
    if (!res.ok) {
      let msg = `Drive error ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body.error?.message) msg = body.error.message;
      } catch {
        // not JSON
      }
      throw new DriveError(msg, res.status);
    }
    return res;
  }

  /** All files matching a search query (follows paging). */
  async list(query: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let page = '';
    do {
      const params = new URLSearchParams({ q: query, fields: `nextPageToken,files(${FIELDS})`, pageSize: '200', spaces: 'drive' });
      if (page) params.set('pageToken', page);
      const body = (await (await this.call(`${API}/files?${params}`)).json()) as { files?: DriveFile[]; nextPageToken?: string };
      out.push(...(body.files ?? []));
      page = body.nextPageToken ?? '';
    } while (page);
    return out;
  }

  async get(id: string): Promise<DriveFile> {
    return (await this.call(`${API}/files/${encodeURIComponent(id)}?fields=${FIELDS}`)).json() as Promise<DriveFile>;
  }

  /** The first folder with this name in the parent (or anywhere the app can see). */
  async findFolder(name: string, parent?: string): Promise<DriveFile | null> {
    const parts = [`mimeType = ${q(FOLDER_MIME)}`, `name = ${q(name)}`, 'trashed = false'];
    if (parent) parts.push(`${q(parent)} in parents`);
    const found = await this.list(parts.join(' and '));
    return found[0] ?? null;
  }

  async createFolder(name: string, parent?: string): Promise<DriveFile> {
    const meta: FileMeta = { name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) };
    const res = await this.call(`${API}/files?fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    });
    return res.json() as Promise<DriveFile>;
  }

  async ensureFolder(name: string, parent?: string): Promise<DriveFile> {
    return (await this.findFolder(name, parent)) ?? this.createFolder(name, parent);
  }

  /** Files in a folder whose name matches exactly. */
  async findFile(name: string, parent: string): Promise<DriveFile | null> {
    const found = await this.list(`name = ${q(name)} and ${q(parent)} in parents and trashed = false`);
    return found[0] ?? null;
  }

  private multipart(meta: FileMeta, body: Blob): { body: Blob; type: string } {
    const boundary = `cb${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const parts = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${meta.mimeType ?? (body.type || 'application/octet-stream')}\r\n\r\n`,
      body,
      `\r\n--${boundary}--`,
    ];
    return { body: new Blob(parts), type: `multipart/related; boundary=${boundary}` };
  }

  async create(meta: FileMeta, content: Blob): Promise<DriveFile> {
    const m = this.multipart(meta, content);
    const res = await this.call(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': m.type },
      body: m.body,
    });
    return res.json() as Promise<DriveFile>;
  }

  /** Replace a file's content in place (the file id stays the same), optionally renaming it. */
  async update(id: string, content: Blob, meta: Omit<FileMeta, 'parents'> = {}): Promise<DriveFile> {
    const m = this.multipart(meta, content);
    const res = await this.call(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=multipart&fields=${FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': m.type },
      body: m.body,
    });
    return res.json() as Promise<DriveFile>;
  }

  async download(id: string): Promise<Blob> {
    return (await this.call(`${API}/files/${encodeURIComponent(id)}?alt=media`)).blob();
  }
}

export const drive = new Drive();
