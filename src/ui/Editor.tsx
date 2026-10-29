import { useEffect, useRef, useState } from 'preact/hooks';
import { deletePuzzle, duplicatePuzzle } from '../data/puzzles';
import { slotLabel, slotPattern } from '../model/grid';
import { exportPuz, puzzleFileBase } from '../model/puz';
import { authState } from '../google/auth';
import { backupStatus } from '../sync/backup';
import { DAYS, STATUSES, SYMMETRIES, type Day, type Puzzle, type Status, type Symmetry } from '../model/types';
import { navigate, wide } from '../state/app';
import { EditorSession, type PanelName } from '../state/editor';
import { AutofillPanel, SelectBanner } from './AutofillPanel';
import { CheckPanel } from './CheckPanel';
import { ClueEditor } from './Clue';
import { Chips, Dialog, Menu, relativeTime, Sheet, type MenuItem } from './common';
import { FillPanel } from './FillPanel';
import { Grid } from './Grid';
import {
  IconAutofill,
  IconBack,
  IconBlock,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClue,
  IconFill,
  IconMore,
  IconRebus,
  IconRedo,
  IconSelect,
  IconUndo,
} from './icons';
import { Keyboard } from './Keyboard';
import { ThemePanel } from './ThemePanel';

export function EditorScreen({ id }: { id: string }) {
  const [session, setSession] = useState<EditorSession | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    let opened: EditorSession | null = null;
    setSession(null);
    setMissing(false);
    void EditorSession.open(id).then((s) => {
      if (!alive) {
        void s?.close();
        return;
      }
      opened = s;
      if (s) setSession(s);
      else setMissing(true);
    });
    return () => {
      alive = false;
      void opened?.close();
    };
  }, [id]);

  if (missing) {
    return (
      <div class="screen center-msg">
        <p>This puzzle isn't on this phone.</p>
        <button class="btn primary" onClick={() => navigate({ name: 'home' })}>
          Back to puzzles
        </button>
      </div>
    );
  }
  if (!session) return <div class="screen" />;
  return <Editor s={session} />;
}

function Editor({ s }: { s: EditorSession }) {
  usePhysicalKeyboard(s);
  const isWide = wide.value;
  return (
    <div class={`screen editor ${isWide ? 'editor-wide' : 'editor-cover'}`}>
      <EditorHeader s={s} />
      {isWide ? (
        <div class="editor-body">
          <div class="editor-left">
            <Grid s={s} />
            <ClueBar s={s} />
            <Keyboard s={s} />
          </div>
          <div class="editor-right">
            <ToolRow s={s} wide />
            <SidePanel s={s} />
          </div>
        </div>
      ) : (
        <>
          <Grid s={s} />
          <ClueBar s={s} />
          {s.panel.value === 'clue' && <ClueEditor s={s} full onClose={() => (s.panel.value = null)} />}
          {s.panel.value ? (
            <PanelSheet s={s} />
          ) : (
            <>
              <ToolRow s={s} />
              <Keyboard s={s} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function saveText(s: EditorSession): string {
  switch (s.saveState.value) {
    case 'saving':
    case 'pending':
      return 'Saving…';
    case 'error':
      return 'Not saved · retrying';
    default: {
      const last = backupStatus.value.lastBackup;
      if (authState.value === 'paused') return 'Saved on phone · Backup paused';
      if (authState.value === 'connected' && last) return `Saved · Drive ${relativeTime(last)}`;
      return `Saved on phone · ${relativeTime(s.savedAt.value)}`;
    }
  }
}

/** Save the puzzle as an Across Lite file (downloads on Android, desktop alike). */
function downloadPuz(p: Puzzle): void {
  const blob = new Blob([exportPuz(p) as BlobPart], { type: 'application/x-crossword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${puzzleFileBase(p)}.puz`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function EditorHeader({ s }: { s: EditorSession }) {
  const p = s.puzzle.value;
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<null | 'rename' | 'settings' | 'delete'>(null);
  // refresh the "x min ago" label
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const items: MenuItem[] = [
    { label: 'Rename', onSelect: () => setDialog('rename') },
    { label: 'Puzzle settings', onSelect: () => setDialog('settings') },
    { label: 'Theme entries', onSelect: () => (s.panel.value = 'theme') },
    { label: 'Export .puz', hint: 'Across Lite, with clues', onSelect: () => downloadPuz(s.puzzle.value) },
    {
      label: 'Duplicate',
      onSelect: async () => {
        await s.flush();
        const copy = await duplicatePuzzle(s.puzzle.value);
        navigate({ name: 'editor', id: copy.id });
      },
    },
    { label: 'Delete', danger: true, onSelect: () => setDialog('delete') },
  ];

  return (
    <header class="topbar editor-head">
      <button class="icon-btn" aria-label="Back to puzzles" onClick={() => navigate({ name: 'home' })}>
        <IconBack />
      </button>
      <div class="head-title">
        <div class="title" onClick={() => setDialog('rename')}>
          {p.title}
        </div>
        <div class={`sub${s.saveState.value === 'error' ? ' warn' : ''}`}>
          {wide.value && `${p.width}×${p.height} · ${p.day} · `}
          {saveText(s)}
        </div>
      </div>
      <button class="pill-btn" disabled={!s.canUndo.value} onClick={() => s.undo()} aria-label="Undo">
        <IconUndo size={18} />
        <span>Undo</span>
      </button>
      <button class="icon-btn" disabled={!s.canRedo.value} onClick={() => s.redo()} aria-label="Redo">
        <IconRedo />
      </button>
      <button class="icon-btn" aria-label="More" onClick={() => setMenu(true)}>
        <IconMore />
      </button>
      {menu && <Menu items={items} onClose={() => setMenu(false)} />}
      {dialog === 'rename' && <RenameDialog p={p} onSave={(title) => s.updateMeta({ title })} onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog s={s} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <Dialog
          title="Delete puzzle?"
          onClose={() => setDialog(null)}
          actions={
            <>
              <button class="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                class="btn danger"
                onClick={async () => {
                  await s.close();
                  await deletePuzzle(p.id);
                  navigate({ name: 'home' }, true);
                }}
              >
                Delete
              </button>
            </>
          }
        >
          <p>
            “{p.title}” and its undo history will be removed from this phone.
          </p>
        </Dialog>
      )}
    </header>
  );
}

function RenameDialog({ p, onSave, onClose }: { p: Puzzle; onSave: (t: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState(p.title);
  const save = () => {
    if (title.trim()) onSave(title.trim());
    onClose();
  };
  return (
    <Dialog
      title="Rename"
      onClose={onClose}
      actions={
        <button class="btn primary" onClick={save}>
          Save
        </button>
      }
    >
      <input
        class="field"
        value={title}
        autoFocus
        onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        aria-label="Title"
      />
    </Dialog>
  );
}

const SYMMETRY_LABEL: Record<Symmetry, string> = {
  rotational: 'Rotational',
  'left-right': 'Left-right',
  diagonal: 'Diagonal',
  none: 'None',
};

function SettingsDialog({ s, onClose }: { s: EditorSession; onClose: () => void }) {
  const p = s.puzzle.value;
  const [outlet, setOutlet] = useState(p.outlet);
  return (
    <Dialog
      title="Puzzle settings"
      onClose={onClose}
      actions={
        <button class="btn primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <label class="label">Day</label>
      <Chips label="Day" options={DAYS} value={p.day} onChange={(day: Day) => s.updateMeta({ day })} />
      <label class="label">Outlet</label>
      <input
        class="field"
        value={outlet}
        aria-label="Outlet"
        onInput={(e) => setOutlet((e.target as HTMLInputElement).value)}
        onBlur={() => s.updateMeta({ outlet: outlet.trim() || p.outlet })}
      />
      <label class="label">Status</label>
      <Chips label="Status" options={STATUSES} value={p.status} onChange={(status: Status) => s.updateMeta({ status })} />
      <label class="label">Block symmetry</label>
      <Chips
        label="Block symmetry"
        options={SYMMETRIES.filter((v) => v !== 'diagonal' || p.width === p.height).map((v) => ({ value: v, label: SYMMETRY_LABEL[v] }))}
        value={p.symmetry}
        onChange={(symmetry: Symmetry) => s.updateMeta({ symmetry })}
      />
    </Dialog>
  );
}

function ClueBar({ s }: { s: EditorSession }) {
  const slot = s.currentSlot.value;
  const p = s.puzzle.value;
  if (s.fill.selectMode.value) return <SelectBanner s={s} />;
  if (s.rebusMode.value) {
    return (
      <div class="cluebar rebus">
        <div class="cluebar-main" onClick={() => s.toggleRebus()}>
          <div class="cluebar-top">
            <span class="cluebar-label">Rebus</span>
            <span class="mono">{p.cells[s.cursor.value.cell].rebus ?? p.cells[s.cursor.value.cell].l ?? ''}</span>
          </div>
          <div class="cluebar-clue">Type the letters for this square · tap here when done</div>
        </div>
      </div>
    );
  }
  return (
    <div class="cluebar">
      <button class="icon-btn" aria-label="Previous entry" onClick={() => s.stepEntry(-1)}>
        <IconChevronLeft />
      </button>
      <div class="cluebar-main" onClick={() => s.switchDirection()} role="button" aria-label="Switch direction">
        {slot ? (
          <>
            <div class="cluebar-top">
              <span class="cluebar-label">{slotLabel(slot)}</span>
              <span class="mono pattern">{slotPattern(p.cells, slot)}</span>
            </div>
            <div class="cluebar-clue">{p.clues[slot.id]?.text || `No clue yet · ${slot.cells.length} letters`}</div>
          </>
        ) : (
          <div class="cluebar-clue">{p.cells[s.cursor.value.cell]?.b ? 'Block' : 'Unchecked square'}</div>
        )}
      </div>
      <button class="icon-btn" aria-label="Next entry" onClick={() => s.stepEntry(1)}>
        <IconChevronRight />
      </button>
    </div>
  );
}

const LONG_PRESS_MS = 450;

function ToolRow({ s, wide: isWide = false }: { s: EditorSession; wide?: boolean }) {
  const [blockMenu, setBlockMenu] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const open = (name: PanelName) => () => {
    if (name === 'select') {
      if (s.fill.selectMode.value) s.fill.exitSelect();
      else s.fill.enterSelect();
      return;
    }
    s.panel.value = s.panel.value === name ? null : name;
  };
  const active = s.fill.selectMode.value ? 'select' : s.panel.value;
  const matches = s.fill.list.value?.atFloor;
  const issues = s.fill.report.value?.count ?? 0;

  const blockDown = () => {
    longFired.current = false;
    timer.current = setTimeout(() => {
      longFired.current = true;
      setBlockMenu(true);
    }, LONG_PRESS_MS);
  };
  const blockUp = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!longFired.current) s.toggleBlock();
  };
  const blockCancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const tool = (name: Exclude<PanelName, null>, label: string, Icon: typeof IconFill, extra = '', badge?: string) => (
    <button class={`tool${active === name ? ' on' : ''} ${extra}`} onClick={open(name)} aria-pressed={active === name} aria-label={label}>
      <Icon />
      <span>{label}</span>
      {badge && <span class={`tool-badge${name === 'check' ? ' warn' : ''}`}>{badge}</span>}
    </button>
  );

  return (
    <div class={`toolrow${isWide ? ' toolrow-wide' : ''}`}>
      {tool('select', 'Select', IconSelect, 'tool-select')}
      {!isWide && tool('fill', 'Fill', IconFill, 'tool-primary', matches === undefined ? undefined : matches > 999 ? '999+' : String(matches))}
      {tool('autofill', 'Autofill', IconAutofill)}
      {tool('check', 'Check', IconCheck, '', issues ? String(issues) : undefined)}
      {!isWide && tool('clue', 'Clue', IconClue)}
      <button
        class="tool"
        aria-label="Block (hold for rebus, circle, lock)"
        onPointerDown={blockDown}
        onPointerUp={blockUp}
        onPointerLeave={blockCancel}
        onPointerCancel={blockCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <IconBlock />
        <span>Block</span>
        <span class="tool-dots" aria-hidden="true" />
      </button>
      {isWide && (
        <button class={`tool${s.rebusMode.value ? ' on' : ''}`} onClick={() => s.toggleRebus()} aria-pressed={s.rebusMode.value}>
          <IconRebus />
          <span>Rebus</span>
        </button>
      )}
      {blockMenu && (
        <Menu
          anchor="bottom"
          onClose={() => setBlockMenu(false)}
          items={[
            { label: 'Rebus', hint: 'Several letters in one square', onSelect: () => s.toggleRebus() },
            { label: 'Circle', hint: 'Toggle on this square', onSelect: () => s.toggleCircle() },
            { label: 'Lock word', hint: 'Theme entry; typing skips it', onSelect: () => s.toggleLock() },
          ]}
        />
      )}
    </div>
  );
}


function PanelSheet({ s }: { s: EditorSession }) {
  const name = s.panel.value;
  if (!name) return null;
  const close = () => (s.panel.value = null);
  if (name === 'fill') {
    return (
      <div class="sheet tall" role="dialog" aria-label="Fill suggestions">
        <FillPanel s={s} onClose={close} />
      </div>
    );
  }
  if (name === 'autofill') {
    return (
      <div class="sheet tall" role="dialog" aria-label="Autofill">
        <AutofillPanel s={s} onClose={close} />
      </div>
    );
  }
  if (name === 'check') {
    return (
      <div class="sheet tall" role="dialog" aria-label="Check">
        <CheckPanel s={s} onClose={close} />
      </div>
    );
  }
  // The clue editor is a full page on the cover screen; keep the tool row under it.
  if (name === 'clue') return <ToolRow s={s} />;
  if (name === 'theme') {
    return (
      <Sheet title="Theme entries" onClose={close}>
        <ThemePanel s={s} />
      </Sheet>
    );
  }
  // 'select' runs through the select-mode banner, not a sheet.
  return null;
}

const TABS = ['Fill', 'Clues', 'Theme'] as const;

function SidePanel({ s }: { s: EditorSession }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Fill');
  const name = s.panel.value;
  const close = () => (s.panel.value = null);
  // Tools that open a tab on the cover screen pick that tab here.
  useEffect(() => {
    if (name === 'clue') setTab('Clues');
    else if (name === 'theme') setTab('Theme');
    else if (name === 'fill') setTab('Fill');
  }, [name]);
  if (name === 'autofill' || name === 'check') {
    return <div class="side-panel">{name === 'autofill' ? <AutofillPanel s={s} onClose={close} /> : <CheckPanel s={s} onClose={close} />}</div>;
  }
  const current = name === 'clue' ? 'Clues' : name === 'theme' ? 'Theme' : tab;
  return (
    <div class="side-panel">
      <div class="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === current}
            class={`tab${t === current ? ' on' : ''}`}
            onClick={() => {
              setTab(t);
              if (name === 'clue' || name === 'theme') s.panel.value = null;
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {current === 'Fill' ? (
        <FillPanel s={s} wide />
      ) : current === 'Clues' ? (
        <ClueEditor s={s} />
      ) : (
        <div class="panel-body">
          <ThemePanel s={s} />
        </div>
      )}
    </div>
  );
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** Physical keyboard: letters, Backspace, arrows, Space, Tab, Ctrl+Z / Ctrl+Y. */
function usePhysicalKeyboard(s: EditorSession) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector('.overlay, [data-blocks-keys]')) return;
      const k = e.key;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (k === 'z' || k === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && (k === 'y' || k === 'Y')) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod || e.altKey) return;
      if (/^[a-zA-Z]$/.test(k)) s.typeLetter(k);
      else if (k === 'Backspace' || k === 'Delete') s.backspace();
      else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') s.arrow(k);
      else if (k === ' ') s.switchDirection();
      else if (k === 'Tab') s.stepEntry(e.shiftKey ? -1 : 1);
      else if (k === '.') s.toggleBlock();
      else if (k === 'Enter' && s.rebusMode.value) s.toggleRebus();
      else if (k === 'Escape') {
        if (s.rebusMode.value) s.toggleRebus();
        else if (s.fill.selectMode.value) s.fill.exitSelect();
        else s.panel.value = null;
      } else return;
      e.preventDefault();
      // A focused button would otherwise also activate on Space/Enter keyup.
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);
}
