// Google Picker (SPEC §3.9, §5.3). Picking a file shares it with this app under the
// drive.file scope, which is how the data pack (put in Drive by the laptop) gets in.
import { GOOGLE_API_KEY, GOOGLE_APP_ID } from '../config';
import { getToken } from './auth';
import { FOLDER_MIME } from './drive';
import { loadScript } from './loader';

export interface PickedDoc {
  id: string;
  name: string;
  mimeType?: string;
}

/* The part of google.picker this app uses. */
interface DocsView {
  setIncludeFolders(b: boolean): DocsView;
  setSelectFolderEnabled(b: boolean): DocsView;
  setMimeTypes(m: string): DocsView;
  setMode(m: unknown): DocsView;
  setParent(id: string): DocsView;
  setQuery(q: string): DocsView;
}
interface PickerBuilder {
  setAppId(id: string): PickerBuilder;
  setOAuthToken(t: string): PickerBuilder;
  setDeveloperKey(k: string): PickerBuilder;
  addView(v: DocsView): PickerBuilder;
  enableFeature(f: unknown): PickerBuilder;
  setTitle(t: string): PickerBuilder;
  setCallback(cb: (data: Record<string, unknown>) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}
interface PickerNs {
  DocsView: new (viewId?: unknown) => DocsView;
  PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCS: unknown; FOLDERS: unknown };
  DocsViewMode: { LIST: unknown };
  Feature: { MULTISELECT_ENABLED: unknown };
  Response: { ACTION: string; DOCUMENTS: string };
  Action: { PICKED: string; CANCEL: string };
  Document: { ID: string; NAME: string; MIME_TYPE: string };
}

declare const gapi: { load(name: string, cb: { callback: () => void; onerror: () => void }): void };

let ready: Promise<PickerNs> | null = null;

function pickerNs(): Promise<PickerNs> {
  ready ??= (async () => {
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise<void>((resolve, reject) => gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Picker did not load')) }));
    return (window as unknown as { google: { picker: PickerNs } }).google.picker;
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

function show(build: (ns: PickerNs, b: PickerBuilder) => PickerBuilder, token: string, ns: PickerNs): Promise<PickedDoc[]> {
  return new Promise((resolve) => {
    const b = new ns.PickerBuilder().setAppId(GOOGLE_APP_ID).setOAuthToken(token).setDeveloperKey(GOOGLE_API_KEY);
    build(ns, b)
      .setCallback((data) => {
        const action = data[ns.Response.ACTION];
        if (action === ns.Action.PICKED) {
          const docs = (data[ns.Response.DOCUMENTS] as Record<string, string>[]) ?? [];
          resolve(docs.map((d) => ({ id: d[ns.Document.ID], name: d[ns.Document.NAME], mimeType: d[ns.Document.MIME_TYPE] })));
        } else if (action === ns.Action.CANCEL) resolve([]);
      })
      .build()
      .setVisible(true);
  });
}

/** Multi-select files, opening in `parent` (a folder id) when given. Empty when cancelled. */
export async function pickFiles(title: string, parent?: string): Promise<PickedDoc[]> {
  const [ns, token] = await Promise.all([pickerNs(), getToken()]);
  return show(
    (ns, b) => {
      const view = new ns.DocsView(ns.ViewId.DOCS).setIncludeFolders(true).setMode(ns.DocsViewMode.LIST);
      if (parent) view.setParent(parent);
      return b.addView(view).enableFeature(ns.Feature.MULTISELECT_ENABLED).setTitle(title);
    },
    token,
    ns,
  );
}

/** Pick one folder (to use an existing "Crossword Builder" folder). Null when cancelled. */
export async function pickFolder(title: string, query?: string): Promise<PickedDoc | null> {
  const [ns, token] = await Promise.all([pickerNs(), getToken()]);
  const docs = await show(
    (ns, b) => {
      const view = new ns.DocsView(ns.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME).setMode(ns.DocsViewMode.LIST);
      if (query) view.setQuery(query);
      return b.addView(view).setTitle(title);
    },
    token,
    ns,
  );
  return docs[0] ?? null;
}
