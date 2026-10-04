import { ControlEvents, ControlError } from '../policy/events.js';

export const NavigationDisplayMode = Object.freeze({ Minimal: 0, Compact: 1, Expanded: 2 });
export const SplitDisplayMode = Object.freeze({ Overlay: 0, Inline: 1, CompactOverlay: 2, CompactInline: 3 });
const paneModes = ['Auto', 'Left', 'Top', 'LeftCompact', 'LeftMinimal'];
const splitModes = Object.keys(SplitDisplayMode);

function nonnegative(value, fallback, name) {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < 0) throw new ControlError('SFUI1679', 'Invalid navigation dimension', { name, value });
  return result;
}

function choice(value, names, fallback = 0) {
  const index = typeof value === 'string' ? names.indexOf(value) : value ?? fallback;
  if (!Number.isInteger(index) || !names[index]) throw new ControlError('SFUI1679', 'Unknown navigation display mode', { value });
  return index;
}

/** Returns the native display mode from the available width in effective pixels. */
export function navigationDisplayMode(properties, width) {
  const mode = choice(properties.PaneDisplayMode, paneModes);
  if (mode === 1 || mode === 2) return NavigationDisplayMode.Expanded;
  if (mode === 3) return NavigationDisplayMode.Compact;
  if (mode === 4) return NavigationDisplayMode.Minimal;
  const compact = nonnegative(properties.CompactModeThresholdWidth, 641, 'CompactModeThresholdWidth');
  const expanded = nonnegative(properties.ExpandedModeThresholdWidth, 1008, 'ExpandedModeThresholdWidth');
  if (compact > expanded) throw new ControlError('SFUI1679', 'Compact threshold exceeds expanded threshold');
  return width >= expanded ? NavigationDisplayMode.Expanded : width >= compact ? NavigationDisplayMode.Compact : NavigationDisplayMode.Minimal;
}

/** Pure geometry shared by DOM placement and managed Measure/Arrange. */
export function navigationGeometry(kind, properties, available) {
  const width = nonnegative(available.width, 0, 'width');
  const height = nonnegative(available.height, 0, 'height');
  const navigation = kind === 'NavigationView';
  const top = navigation && choice(properties.PaneDisplayMode, paneModes) === 2;
  const displayMode = navigation ? navigationDisplayMode(properties, width) : choice(properties.DisplayMode, splitModes);
  const open = properties.IsPaneOpen !== false;
  const compact = Math.min(width, nonnegative(properties.CompactPaneLength, 48, 'CompactPaneLength'));
  const expanded = Math.min(width, nonnegative(properties.OpenPaneLength, 320, 'OpenPaneLength'));
  const overlay = navigation ? displayMode !== NavigationDisplayMode.Expanded : displayMode === 0 || displayMode === 2;
  const collapsed = navigation ? displayMode === NavigationDisplayMode.Compact ? compact : 0 : displayMode >= 2 ? compact : 0;
  const paneLength = top ? width : open ? expanded : collapsed;
  const reserved = top ? 0 : overlay ? collapsed : paneLength;
  const right = !navigation && (properties.PanePlacement === 1 || properties.PanePlacement === 'Right');
  const topLength = top || navigation && displayMode === NavigationDisplayMode.Minimal ? Math.min(height, 48) : 0;
  const box = (x, y, boxWidth, boxHeight) => ({ x, y, width: boxWidth, height: boxHeight });
  return { displayMode, top, overlay: overlay && open && !top, open, paneLength,
    pane: top ? box(0, 0, width, topLength) : box(right ? width - paneLength : 0, 0, paneLength, height),
    content: box(right ? 0 : reserved, topLength, width - reserved, height - topLength),
    chrome: box(0, 0, width, height) };
}

/** Synchronous pane lifecycle. Cancellation is observed before a visible state change. */
export class PaneState extends ControlEvents {
  constructor({ open = false, displayMode = null } = {}) {
    super();
    this.open = !!open;
    this.displayMode = displayMode;
    this.transitioning = false;
    this.requestRevision = 0;
  }

  setOpen(value, reason = 'Programmatic', { approved = false } = {}) {
    this.requestRevision++;
    this.requestController?.abort();
    const open = !!value;
    if (open === this.open) return false;
    if (this.transitioning) throw new ControlError('SFUI1679', 'Reentrant pane transition');
    this.transitioning = true;
    try {
      const args = { Cancel: false, IsPaneOpen: open, Reason: reason };
      if (!approved) this.emit(open ? 'PaneOpening' : 'PaneClosing', args);
      if (args.Cancel) return false;
      this.open = open;
      this.emit(open ? 'PaneOpened' : 'PaneClosed', { IsPaneOpen: open, Reason: reason });
      return true;
    } finally { this.transitioning = false; }
  }

  async requestOpen(value, request, reason = 'Programmatic') {
    const open = !!value;
    const revision = ++this.requestRevision;
    this.requestController?.abort();
    this.requestController = null;
    if (open === this.open) return false;
    const controller = new AbortController();
    this.requestController = controller;
    try {
      const args = await request(open ? 'PaneOpening' : 'PaneClosing',
        { Cancel: false, IsPaneOpen: open, Reason: reason }, { signal: controller.signal });
      if (revision !== this.requestRevision || args.Cancel || controller.signal.aborted) return false;
      return this.setOpen(open, reason, { approved: true });
    } finally { if (this.requestController === controller) this.requestController = null; }
  }

  adapt(properties, width, request = null) {
    const mode = navigationDisplayMode(properties, width);
    if (mode === this.displayMode) return false;
    this.displayMode = mode;
    this.emit('DisplayModeChanged', { DisplayMode: mode });
    if (properties.PaneDisplayMode === 0 || properties.PaneDisplayMode === 'Auto' || properties.PaneDisplayMode == null) {
      if (request) return this.requestOpen(mode === NavigationDisplayMode.Expanded, request, 'Adaptive');
      this.setOpen(mode === NavigationDisplayMode.Expanded, 'Adaptive');
    }
    return true;
  }

  snapshot() { return { version: 1, open: this.open, displayMode: this.displayMode }; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI1679', 'Invalid pane snapshot');
    this.requestRevision++;
    this.requestController?.abort();
    this.open = !!snapshot.open;
    this.displayMode = snapshot.displayMode;
    this.transitioning = false;
  }
  *retainedValues() {}
  dispose() { this.requestRevision++; this.requestController?.abort(); super.dispose(); }
}
