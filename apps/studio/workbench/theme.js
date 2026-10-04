/** Applies tokens immediately; system/forced colors remain under browser control. */
export function applyEnvironment(root, settings, {matchMedia = globalThis.matchMedia?.bind(globalThis)} = {}) {
  const environment = settings.environment ?? settings;
  const previous = {theme: root.dataset.theme, density: root.dataset.density};
  const media = matchMedia?.('(prefers-color-scheme: dark)');
  const update = () => {
    root.dataset.theme = environment.theme === 'system' ? media?.matches ? 'dark' : 'light' : environment.theme;
    root.dataset.density = environment.density;
    root.style.setProperty('--wb-font-family', environment.fontFamily);
    root.style.setProperty('--wb-font-size', environment.fontSize + 'px');
    root.style.setProperty('--wb-row-height', environment.density === 'comfortable' ? '34px' : '26px');
  };
  update();
  if (environment.theme === 'system') media?.addEventListener('change', update);
  return () => {
    media?.removeEventListener('change', update);
    root.dataset.theme = previous.theme ?? 'dark';
    root.dataset.density = previous.density ?? 'compact';
  };
}
