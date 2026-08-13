import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { i18nReady } from './i18n';
import './index.css';
import App from './App.tsx';

// The Baleia dashboard is intentionally light-only. Set this before React mounts so Login and
// lazy-loaded pages never flash an OS-provided dark palette.
document.documentElement.setAttribute('data-theme', 'light');
localStorage.setItem('openwa_theme', 'light');

// The active locale is fetched rather than bundled into the entry, so first paint waits for it —
// otherwise the shell renders raw keys and swaps to real copy a tick later. A catalogue that fails
// to arrive does not hold this up: i18next settles init either way, falling back to English or, if
// nothing loads at all, to raw keys. The second handler is therefore belt and braces rather than the
// live path — but it is what guarantees that no future change to that contract can leave the
// dashboard blank, which is a worse failure than untranslated text.
const render = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

void i18nReady.then(render, render);
