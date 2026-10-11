// Dark (the theatre, default) and light (house lights up) themes. The choice is set on <html> as
// data-theme before first paint by the inline script in index.html, and remembered per browser.
// Colours come from the theme roles in tokens.css; the canvases are told when the theme changes.

import { readToken } from '../util/env.js';

export const THEME_KEY = 'dc-theme';

export const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

/** The star field's colours for the current theme, read from the tokens. */
export const skyTheme = () => ({
  color: readToken('--star'),
  glow: readToken('--star-glow'),
  additive: currentTheme() === 'dark',
});

export function setupTheme({ reduced, onChange }) {
  const root = document.documentElement;
  const button = document.querySelector('[data-theme-toggle]');
  const meta = document.querySelector('meta[name="theme-color"]');
  let fadeTimer = 0;

  const sync = () => {
    const light = currentTheme() === 'light';
    button?.setAttribute('aria-pressed', String(light));
    if (meta) meta.content = readToken('--bg');
  };

  const set = (theme) => {
    if (!reduced) {
      // colours cross-fade for one beat, then normal transitions resume
      root.classList.add('theme-fade');
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => root.classList.remove('theme-fade'), 700);
    }
    root.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode: the choice lasts this visit */ }
    sync();
    onChange?.(theme);
  };

  const onClick = () => set(currentTheme() === 'light' ? 'dark' : 'light');
  button?.addEventListener('click', onClick);
  sync();

  return () => {
    clearTimeout(fadeTimer);
    root.classList.remove('theme-fade');
    button?.removeEventListener('click', onClick);
  };
}
