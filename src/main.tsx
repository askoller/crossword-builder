import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles.css';
import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { getSetting, setSetting } from './data/db';
import { updateReady } from './state/app';
import { startSync } from './sync';
import { App } from './ui/App';

render(<App />, document.getElementById('app')!);

// Drive backup and Notebook sync; local editing never waits on it.
void startSync();

// Ask the browser not to evict our data (SPEC §5.1); remember that we asked.
void (async () => {
  if (await getSetting('persistRequested')) return;
  const granted = (await navigator.storage?.persist?.()) ?? false;
  await setSetting('persistRequested', { at: Date.now(), granted });
})();

if (!import.meta.env.DEV) {
  const update = registerSW({
    onNeedRefresh() {
      updateReady.value = () => void update(true);
    },
  });
}
