import { route, navigate, updateReady, type Route } from '../state/app';
import { EditorScreen } from './Editor';
import { Home } from './Home';
import { IconClues, IconGrid, IconNotebook, IconSettings } from './icons';
import { CluesScreen } from './Clues';
import { NotebookScreen } from './Notebook';
import { Settings } from './Settings';

const NAV: { name: Exclude<Route['name'], 'editor'>; label: string; Icon: typeof IconGrid }[] = [
  { name: 'home', label: 'Puzzles', Icon: IconGrid },
  { name: 'notebook', label: 'Notebook', Icon: IconNotebook },
  { name: 'clues', label: 'Clues', Icon: IconClues },
  { name: 'settings', label: 'Settings', Icon: IconSettings },
];

function BottomNav({ current }: { current: Route['name'] }) {
  return (
    <nav class="bottomnav">
      {NAV.map(({ name, label, Icon }) => (
        <button key={name} class={`nav-item${current === name ? ' on' : ''}`} aria-current={current === name ? 'page' : undefined} onClick={() => navigate({ name } as Route)}>
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function App() {
  const r = route.value;
  if (r.name === 'editor') return <EditorScreen id={r.id} />;
  return (
    <div class="shell">
      {updateReady.value && r.name !== 'settings' && (
        <div class="update-banner">
          <span>Update available</span>
          <button class="btn small primary" onClick={() => updateReady.value?.()}>
            Reload
          </button>
        </div>
      )}
      {r.name === 'home' && <Home />}
      {r.name === 'settings' && <Settings />}
      {r.name === 'notebook' && <NotebookScreen />}
      {r.name === 'clues' && <CluesScreen />}
      <BottomNav current={r.name} />
    </div>
  );
}
