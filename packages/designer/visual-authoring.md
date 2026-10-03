# Visual authoring contracts

The A18 surface consumes `@sharpforge/designer` and the retained `WinUIHost`. The document remains the authority for committed values. A pointer or keyboard session retains temporary rectangles outside the document and submits one optimistic edit when the gesture ends. Escape, pointer cancellation, document replacement and disposal discard temporary state.

## Capability inventory

| Capability | Public API or controller | Contract |
|---|---|---|
| Nested transforms | `coordinateStack`, `localPointerDelta`, `DesignerSurfaceGeometry` | Six-coefficient affine matrices compose layout, scroll, scale, rotation, origin and viewport zoom. Singular and perspective transforms produce diagnostics. Large trees measure selected controls first, then fill the cache in 4ms background slices. |
| Smart guides | `DesignSnaplines` | Edge, center, baseline, parent, user-guide and neighboring equal-spacing targets; default tolerance is six design pixels; Alt disables all snapping. |
| Spatial queries | `DesignSpatialIndex` | Bounded uniform cells; oversized entries and queries use a bounded linear fallback. |
| Outline windows | `DesignOutlineIndex` | Flatten once, then obtain viewport rows with fixed overscan. |
| Atomic geometry | `DesignGeometrySession` | `update` and `nudge` are preview-only. `commit` makes one history operation and checks document revision. `cancel` and `dispose` do not modify the document. |
| Arrangement | `arrangeRectangles`, `arrangeDesignSelection` | Primary-selection alignment; equal gaps between outermost selections; same width, height or size. Pixel arrangement requires sibling Canvas children. |
| Ordering | `reorderDesignSelection` | Stable selected-block front/back/forward/backward operations; Canvas ZIndex reflects child order. |
| Layout anchors | `designAnchors`, `toggleDesignAnchor`, `setDesignMargin` | WinUI Margin and alignment values, with size cleared when both opposing anchors stretch. |
| Track authoring | `editGridTracks`, `resizeGridTracks` | Insert, delete, split, reorder, Auto/Pixel/Star. Reordering rejects a spanning child that would become discontiguous. Auto tracks require a unit selection before splitting. |
| Canvas conversion | `convertCanvasToGrid` | Pixel tracks preserve child identity, order, margins and measured geometry in one undo transaction. Automatic sizes require measurements; protected expressions, locked content and more than 64 tracks fail before mutation. |
| Insertion | `layoutInsertion`, `createDrawnControl` | Stack and wrapped line indicators, either orientation, plus one-commit drawn creation. |
| Guides | `guideSettings`, `setUserGuide`, `updateGuideSettings` | Versioned settings are serialized in `document.designer.guides`; up to 256 guides and configurable grid/guide/sibling snapping. |
| Preview environment | `DesignPreviewEnvironment` | Session-only resolution, scale, light/dark palette, high-contrast palette and RTL. Source serialization and history remain untouched. |
| Adaptive authoring | `setResponsiveState`, `applyResponsivePreview`, `generateResponsiveMethods` | Up to 64 bounded width ranges and normalized property overrides. The highest matching minimum width wins. |
| Inline text | `DesignerInlineText` | F2/double-click edits Text or scalar Content with rendered font properties; Enter commits once, Escape cancels. |
| Draw tool | `DesignerDrawCreate` | Alt+click a Toolbox item to select its drawing tool. A normal click inserts immediately. Dragging from the Toolbox previews insertion before committing. |
| Surface navigation | `anchoredDesignZoom`, `fitDesignBounds`, `DesignerSurfaceZoom` | 10–800% zoom, pointer anchor, fit with 10% padding, Ctrl+0, middle-button or Space-drag pan. |
| Context commands | `DesignerSurfaceCommands` | One registry supplies menu and keyboard enablement, including order, align, layout, resources, semantic source navigation and clipboard commands. |

## Coordinate and gesture example

```javascript
import {DesignDocument, createDesign, DesignGeometrySession} from '@sharpforge/designer';

const document = new DesignDocument(createDesign());
const gesture = new DesignGeometrySession(document, {
  rectangles: {action: {Left: 50, Top: 162, Width: 160, Height: 40}},
  matrices: {action: [0, 4, -6, 0, 100, 120]},
  start: {x: 100, y: 120},
  handle: 'se'
});
gesture.update({x: 40, y: 160});
gesture.commit();
// The local delta is (10, 10), despite the rotated/scaled parent.
document.undo();
```

## Adaptive runtime contract

The Layout panel exposes **Convert to Grid** for a selected Canvas. The operation partitions each axis at child boundaries, retains fixed child dimensions and maps each control to `Row`, `Column` and span properties. Negative Canvas offsets become negative margins; original margins remain effective. It keeps children in their existing order and preserves the selected container identifier. Automatic child dimensions are measured from the real surface before conversion. Changing a container with adaptive child geometry, protected expressions or a Canvas-specific style requires resolving those constraints first; the operation reports an explicit diagnostic and leaves the document unchanged.

`document.responsive` has this versioned shape:

```javascript
{
  version: 1,
  states: [
    {id: 'Compact', minWidth: 0, maxWidth: 600, overrides: {action: {Width: 100}}},
    {id: 'Wide', minWidth: 600, maxWidth: null, overrides: {action: {Width: 240}}}
  ]
}
```

Minimum width is inclusive; maximum width is exclusive. Generation emits a real managed `ApplyAdaptive(double width)` method. It restores overridden properties to their base local values (or clears their local values), then applies one matching state. Generated initialization applies the design width. Application hosts must call `ApplyAdaptive` when their viewport changes. Automatic native `SizeChanged`/`AdaptiveTrigger` execution is unavailable in the current framework contract and emits `SFD_RESPONSIVE_HOST_RESIZE`; it is not presented as native WinUI qualification.

High-contrast preview applies an explicit black/white/yellow preview palette. It does not emulate an operating system's complete forced-colors policy. Browser input preview also does not execute managed event handlers; those execute in the application runtime.

## Studio integration seam

Construct `new DesignerSurfaceController(view)` alongside the other owned controllers. Call `install()` after the stage, preview host, toolbox, outline and chrome exist. The controller owns pointer, keyboard, wheel, pan, drop and context-menu listeners; remove the legacy listeners to prevent duplicate gestures.

Use these delegations:

| Existing consumer | New call |
|---|---|
| Preview scene loading | `surface.scene(document.value)` |
| Model update completion | `surface.onDocumentChanged(event)` |
| Artboard resize completion | `surface.preview.applyDimensions()` and `surface.geometry.invalidate()` |
| Host layout notification | `surface.geometry.invalidate()` then `surface.drawAdorners()` |
| Rectangle measurements | `surface.rect(id)` |
| Adorner updates | `surface.drawAdorners()` |
| Layout panel | `surface.layout.render()` |
| Grid surface rails | `surface.drawGridTracks()` |
| Arrange menu | `surface.align(action)` |
| Context menu | `surface.context(event)` |
| Fit all / fit selection | `surface.fitAll()` / `surface.fitSelection()` |
| Repeated keyboard completion | `surface.finishKeyboard()` |
| Disposal | `surface.dispose()` |

Toolbar controls are found through `view.controlsRoot ?? view.panel('designer')`. Source-aware undo goes through `view.undo`/`view.canUndo`; semantic handler navigation uses `view.sourceSync.navigateEvent`. Hidden and locked outline state is respected through `view.outline`.

## Qualification commands

```sh
node --test tests/a18-visual-*.test.js
node packages/designer/examples/visual-layout.mjs
npm run check
npm run check:structure
```

The example creates a two-state Grid design with persisted guides, then reports cold index construction and warm median/p95/p99 geometry latency for 5,000 nodes. Heap delta is reported as retained/GC-sensitive memory, not an allocation-count claim.

Browser qualification uses `runDesignerLayoutReferences(root)` from `apps/studio/designer-layout-reference.js`. It compiles Canvas, Grid, StackPanel, ScrollViewer and Viewbox scenes, executes source VM and direct CIL independently, renders their runtime scenes with `WinUIHost`, and compares against designer geometry with a 0.5px tolerance. A Node scene execution test is not browser layout qualification. Native Windows/macOS/Linux rendering, WebGPU and Canvas2D must be recorded separately from DOM results.

## Recorded local evidence

On Linux x64, AMD EPYC 9V74, Node v24.19.0, the 5,000-node/200-sample geometry benchmark measured 31.25ms cold construction, 0.050ms warm median, 0.109ms p95 and 0.715ms p99, with a 4,047,928-byte retained/GC-sensitive heap delta. This is JavaScript geometry and spatial-query timing, not an end-to-end browser frame budget or a native rendering result. Duplicate target compaction bounds repeated aligned snap targets.

The browser build completed. A local Playwright browser run was attempted, but the Chromium executable was absent; the executable reference harness remains available for the integration environment. The full repository check currently needs A18 test-manifest registration by the shared-file owner. The repository structure report contains inherited warnings; no new visual-owned source file exceeds the declared source limits.
