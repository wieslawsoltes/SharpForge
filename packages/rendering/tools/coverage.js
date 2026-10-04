import {registerRenderingAdapters} from '../src/contracts/adapters.js';
import {registerCompositionAdapters} from '../src/composition/adapters.js';
import {createControlRenderers} from '../src/controls/delegates.js';

const drawingAdapter = 'packages/rendering/src/contracts/adapters.js';
const compositionAdapter = 'packages/rendering/src/composition/adapters.js';
const propertyAdapter = 'packages/winui-properties/src/adapters';
const runtimeAdapter = 'packages/runtime/src/ui';
const nativeInputs = new Set(['TextBox', 'PasswordBox', 'RichEditBox', 'AutoSuggestBox', 'NumberBox']);
const materialNames = new Set(['AcrylicBrush', 'RevealBrush', 'MicaBackdrop', 'DesktopAcrylicBackdrop', 'ThemeShadow']);
const typePrefixes = ['Microsoft.UI.Xaml.', 'Microsoft.UI.Composition.', 'Microsoft.Graphics.Canvas.', 'SharpForge.UI.'];
const valueTypes = new Set(['Microsoft.UI.Colors', 'Microsoft.UI.ColorHelper', 'Windows.UI.Color',
  'Windows.Foundation.Point', 'Windows.Foundation.Size', 'Windows.Foundation.Rect',
  'System.Numerics.Vector2', 'System.Numerics.Vector3', 'System.Numerics.Vector4', 'System.Numerics.Quaternion', 'System.Numerics.Matrix4x4']);

function registrations() {
  const entries = new Map();
  const collect = source => ({register({owner, name, kind = 'method', arity = '*'}) {
    entries.set(`${owner}:${kind}:${name}:${arity}`, source);
  }});
  registerRenderingAdapters(collect(drawingAdapter));
  registerCompositionAdapters(collect(compositionAdapter));
  return entries;
}

function registeredAdapter(member, types, adapters) {
  let owner = member.owner;
  const seen = new Set();
  while (owner && !seen.has(owner)) {
    seen.add(owner);
    const source = adapters.get(`${owner}:${member.kind}:${member.name}:${member.parameters.length}`) ??
      adapters.get(`${owner}:${member.kind}:${member.name}:*`);
    if (source) return {status: 'native-adapter', adapter: source, adapterOwner: owner};
    owner = member.kind === 'constructor' ? null : types.get(owner)?.base;
  }
  if (['get', 'set', 'attachedGet', 'attachedSet'].includes(member.kind)) {
    return {status: 'shared-property-store', adapter: propertyAdapter, adapterOwner: member.owner};
  }
  if (['constructor', 'eventAdd', 'eventRemove'].includes(member.kind) || member.owner.startsWith('SharpForge.UI.')) {
    return {status: 'host-runtime', adapter: runtimeAdapter, adapterOwner: member.owner};
  }
  return {status: 'review-runtime-dispatch', adapter: runtimeAdapter, adapterOwner: member.owner};
}

function renderingRoute(type, delegates) {
  const name = type.name.split('.').at(-1);
  if (nativeInputs.has(name)) return {canvas2d: 'native-input-overlay', webgpu: 'native-input-overlay', dom: 'native-input',
    note: 'Native editing, IME, clipboard and accessibility; capture requires captureNativeElement.'};
  if (type.name.includes('.Media.Animation.')) return {canvas2d: 'timeline-composition', webgpu: 'timeline-composition',
    dom: 'timeline-composition', note: 'Timeline state feeds retained transforms/resources; this type does not draw directly.'};
  if (type.name.startsWith('Microsoft.UI.Composition.')) return {canvas2d: 'retained-composition', webgpu: 'retained-composition',
    dom: 'retained-composition', note: 'Compositor resources, scene layers and explicit per-operation fallback policy.'};
  if (materialNames.has(name)) return {canvas2d: 'bounded-raster-or-fallback-color', webgpu: 'material-effect-or-fallback-color',
    dom: 'css-or-bounded-raster', note: 'In-app material approximation; no desktop-wallpaper sampling or Reveal lighting engine.'};
  if (name === 'TextBlock' || name === 'RichTextBlock') return {canvas2d: 'shaped-outline-or-native-runs', webgpu: 'numeric-glyph-instances-or-native-run-quads',
    dom: 'glyph-paths-or-native-svg-text', note: 'Bundled HarfBuzz plus pinned fonts/Unicode, or explicit native provider; physical/native pixel qualification is separate.'};
  if (name === 'Image' || name.endsWith('Bitmap') || name === 'BitmapImage' || name === 'ImageBrush' || name === 'LoadedImageSurface') {
    return {canvas2d: 'decoded-image-raster', webgpu: 'decoded-image-texture', dom: 'image-or-svg-pattern',
      note: 'Image URLs use an injected authorized loader; resources remain scoped to their owning table.'};
  }
  if (name === 'DrawingSurface' || name.startsWith('CanvasDrawing') || name === 'CanvasControl' || name === 'CanvasAnimatedControl') {
    return {canvas2d: 'display-list', webgpu: 'display-list', dom: 'svg-display-list',
      note: 'Only registered legacy/Win2D subset members are supported; Draw emits versioned data packets.'};
  }
  if (name === 'SwapChainPanel') return {canvas2d: 'explicit-canvas-handoff', webgpu: 'explicit-canvas-handoff',
    dom: 'explicit-canvas-handoff', note: 'External frame submission uses the borrowed app device and retained layout dimensions.'};
  if (delegates.get(type.name)) return {canvas2d: 'control-display-list', webgpu: 'control-display-list', dom: 'svg-display-list',
    note: type.kind === 'shape' ? 'Native geometry/brush rendering in every supported parent.' :
      'Resolved template descendants provide chrome; semantic DOM remains the accessibility owner.'};
  if (type.kind === 'control' || type.kind === 'shape') return {canvas2d: 'dom-fallback', webgpu: 'dom-fallback', dom: 'registered-host-renderer',
    note: 'No direct A17 draw delegate; the registered host or template descendants own visual output.'};
  return {canvas2d: 'retained-value', webgpu: 'retained-value', dom: 'retained-value',
    note: 'Value, resource, metadata or state object; consumed by a drawing operation rather than painted independently.'};
}

/** Enumerate actual framework types/members and adapter registrations; this is coverage metadata, never a passing test report. */
export function createRenderingCoverage(manifest) {
  const types = new Map(manifest.types.map(type => [type.name, type]));
  const selected = manifest.types.filter(type => valueTypes.has(type.name) || typePrefixes.some(prefix => type.name.startsWith(prefix)));
  const selectedNames = new Set(selected.map(type => type.name));
  const delegates = createControlRenderers({resolveType: type => types.get(type)});
  const adapters = registrations();
  const members = manifest.members.filter(member => selectedNames.has(member.owner)).map(member => ({
    id: member.id, owner: member.owner, name: member.name, kind: member.kind, parameters: [...member.parameters],
    result: member.result, isStatic: member.isStatic, ...registeredAdapter(member, types, adapters)
  })).sort((left, right) => left.id - right.id);
  const byOwner = new Map();
  for (const member of members) {
    const ids = byOwner.get(member.owner) ?? [];
    ids.push(member.id); byOwner.set(member.owner, ids);
  }
  return {schemaVersion: 1, frameworkAbiVersion: manifest.version,
    generatedBy: 'packages/rendering/tools/generate-coverage.js',
    qualification: {automated: 'pending-consolidated-validation', browserPixels: 'pending-browser-oracles',
      nativeWinUI: 'pending-native-WinUI-oracle', physicalGpu: 'unqualified',
      note: 'Adapter presence is implementation metadata. Runtime-dispatch review rows require additional evidence, not inferred support.'},
    types: selected.sort((left, right) => left.name.localeCompare(right.name, 'en')).map(type => ({
      name: type.name, base: type.base, kind: type.kind ?? 'object', members: byOwner.get(type.name) ?? [],
      rendering: renderingRoute(type, delegates)
    })), members};
}

/** Deterministic documentation regenerated with the same inventory checked by the focused coverage test. */
export function renderingCoverageMarkdown(inventory) {
  const lines = ['# Rendering coverage', '',
    'Generated from the integrated framework registry and actual drawing/composition adapter registrations.', '',
    'Regenerate with `node packages/rendering/tools/generate-coverage.js`. The focused inventory test compares both artifacts without writing them.', '',
    `The registry contains ${inventory.types.length} relevant types and ${inventory.members.length} declared members.`, '',
    '**Implementation inventory only.** Automated validation, browser pixel comparisons and native WinUI comparisons are pending; physical GPU is unqualified.', '',
    'Member IDs, declared signatures, adapter ownership and unresolved runtime dispatch are recorded in `packages/rendering/inventory/drawing-surface.json`.', '',
    'The work-item acceptance map and precise limitations are in [rendering-acceptance.md](rendering-acceptance.md).', '',
    '| Registered type | Canvas2D | WebGPU | DOM/SVG | Policy |',
    '| --- | --- | --- | --- | --- |'];
  for (const type of inventory.types) {
    const route = type.rendering;
    lines.push(`| ${type.name} | ${route.canvas2d} | ${route.webgpu} | ${route.dom} | ${route.note} |`);
  }
  return lines.join('\n') + '\n';
}
