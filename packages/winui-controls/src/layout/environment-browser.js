import { EnvironmentState, environmentSystemColorNames } from './environment-state.js';
import { XamlRootMetrics } from './dpi.js';
import { TextScalePolicy } from './text-scale.js';

const systemColorNames = new Set(environmentSystemColorNames);
const emptyRect = () => ({ X: 0, Y: 0, Width: 0, Height: 0 });

/** Intersect browser client geometry with the host, accounting for an outer CSS transform. */
export function inputPaneIntersection(root, bounds) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return emptyRect();
  const box = root.getBoundingClientRect();
  const left = Math.max(box.left, bounds.x), top = Math.max(box.top, bounds.y);
  const right = Math.min(box.right, bounds.x + bounds.width), bottom = Math.min(box.bottom, bounds.y + bounds.height);
  if (right <= left || bottom <= top || !box.width || !box.height) return emptyRect();
  const sx = root.clientWidth / box.width, sy = root.clientHeight / box.height;
  return { X: (left - box.left) * sx, Y: (top - box.top) * sy, Width: (right - left) * sx, Height: (bottom - top) * sy };
}

/** Browser capability edge. No guessed font sizes, keyboard rectangles, or process-wide observers. */
export class BrowserEnvironmentObserver {
  constructor(root, { state = new EnvironmentState(), textScale = new TextScalePolicy(), onChanged = () => {},
    onInputPane = () => {}, rootId = null } = {}) {
    this.root = root;
    this.document = root.ownerDocument;
    this.window = this.document.defaultView;
    this.state = state;
    this.textScale = textScale;
    this.onInputPane = onInputPane;
    this.disposers = [];
    this.colors = new Map();
    this.disposed = false;
    this.unsubscribe = state.subscribe(change => {
      if (change.changed.includes('HighContrast') || change.changed.includes('DarkTheme')) this.colors.clear();
      root.toggleAttribute('data-sf-high-contrast', state.HighContrast);
      root.toggleAttribute('data-sf-touch', state.TouchMode);
      root.toggleAttribute('data-sf-reduced-motion', !state.AnimationsEnabled);
      if (change.changed.includes('InputPaneOccludedRect')) this.inputPaneChanged(change);
      onChanged(change);
    });
    this.metrics = new XamlRootMetrics(root, { onChanged: value => state.update({ RasterizationScale: value.RasterizationScale,
      Size: { Width: value.Size.width, Height: value.Size.height } }) });
    this.watchMedia('(forced-colors: active)', matched => ({ HighContrast: matched,
      HighContrastScheme: matched ? 'Browser forced colors' : '' }));
    this.watchMedia('(prefers-reduced-motion: reduce)', matched => ({ AnimationsEnabled: !matched }));
    this.watchMedia('(prefers-color-scheme: dark)', matched => ({ DarkTheme: matched }));
    this.watchMedia('(any-pointer: coarse)', matched => ({ TouchMode: matched || this.window.navigator.maxTouchPoints > 0 }));
    this.watch(this.document, 'visibilitychange', () => state.update({ IsHostVisible: !this.document.hidden && root.isConnected }));
    this.watch(this.window.navigator.virtualKeyboard, 'geometrychange', () => this.refreshInputPane());
    this.watch(this.window.visualViewport, 'resize', () => this.refreshInputPane());
    this.watch(this.window.visualViewport, 'scroll', () => this.refreshInputPane());
    this.watch(root, 'focusin', () => this.refreshInputPane());
    this.watch(root, 'focusout', () => this.refreshInputPane());
    this.disposers.push(textScale.subscribe(factor => state.update({ TextScaleFactor: factor })));
    state.update({ RootId: rootId, RasterizationScale: this.metrics.rasterizationScale, TextScaleFactor: textScale.factor,
      Size: { Width: root.clientWidth, Height: root.clientHeight }, IsHostVisible: !this.document.hidden && root.isConnected,
      SystemColors: this.systemPalette() });
  }
  watch(target, event, callback) {
    if (!target?.addEventListener) return;
    target.addEventListener(event, callback);
    this.disposers.push(() => target.removeEventListener(event, callback));
  }
  watchMedia(query, convert) {
    const media = this.window.matchMedia?.(query);
    if (!media) return;
    const refresh = () => {
      this.colors.clear();
      this.state.update({...convert(media.matches), SystemColors: this.systemPalette()});
    };
    this.watch(media, 'change', refresh);
    refresh();
  }
  refresh({ contentId = this.state.ContentId } = {}) {
    if (this.disposed) return;
    this.metrics.refresh();
    this.state.update({ ContentId: contentId, IsHostVisible: !this.document.hidden && this.root.isConnected });
    this.refreshInputPane();
  }
  refreshInputPane() {
    if (this.disposed) return;
    const keyboard = this.window.navigator.virtualKeyboard;
    this.state.update({ InputPaneOccludedRect: inputPaneIntersection(this.root, keyboard?.boundingRect) });
  }
  inputPaneChanged(change) {
    const current = change.current.InputPaneOccludedRect;
    const payload = change.inputPane;
    const visible = current.Width > 0 && current.Height > 0;
    this.onInputPane(visible ? 'Showing' : 'Hiding', payload);
    if (!visible) return;
    queueMicrotask(() => {
      if (this.disposed || payload.EnsuredFocusedElementInView) return;
      const focused = this.document.activeElement;
      if (this.root.contains(focused)) focused?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    });
  }
  setTextScaleFactor(value) { this.textScale.setFactor(value); }
  tryShow() { return this.requestKeyboard('show'); }
  tryHide() { return this.requestKeyboard('hide'); }
  requestKeyboard(method) {
    const keyboard = this.window.navigator.virtualKeyboard;
    if (this.disposed || !keyboard?.[method] || this.document.hidden || !this.root.contains(this.document.activeElement)) return false;
    if (method === 'show' && this.window.navigator.userActivation?.isActive === false) return false;
    try { keyboard[method](); return true; }
    catch (error) {
      if (['NotAllowedError', 'SecurityError', 'InvalidStateError'].includes(error.name)) return false;
      throw error;
    }
  }
  systemColor(name) {
    if (!systemColorNames.has(name)) throw new RangeError('SFUI1670: Unknown system color');
    if (!this.colors.has(name)) {
      const probe = this.document.createElement('span');
      probe.style.color = name;
      probe.style.display = 'none';
      this.root.append(probe);
      this.colors.set(name, this.window.getComputedStyle(probe).color);
      probe.remove();
    }
    return this.colors.get(name);
  }
  systemPalette() { return Object.fromEntries(environmentSystemColorNames.map(name => [name, this.systemColor(name)])); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.metrics.dispose();
    this.unsubscribe();
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.colors.clear();
    for (const name of ['data-sf-high-contrast', 'data-sf-touch', 'data-sf-reduced-motion']) this.root.removeAttribute(name);
  }
}
