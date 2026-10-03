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

Canvas, Grid and VariableSizedWrapGrid dependency property identifiers occupy nine entries in the reserved A18 ABI block. Both managed engines resolve attached storage by declaring owner and public member, so Grid.ColumnSpan and VariableSizedWrapGrid.ColumnSpan remain separate. Clearing an adaptive override restores the runtime default and makes `ReadLocalValue` return `UnsetValue`; it does not turn the default into an authored local value. Existing local values are restored through their original attached setter.

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

The geometry read phase caches browser font metrics and measures the first rendered text line. Pointer sessions receive the moving control's baseline in parent coordinates. Text with an independently rotated baseline is excluded from horizontal baseline targets. Font metrics stay in a bounded controller-owned cache and are disposed with the surface.

Project component navigation uses `view.componentDefinition(id)` and `view.openComponent(id)`. Double-clicking a resolved component opens its defining document; ordinary text controls retain inline editing. The same action is exposed as **Open component document** in the surface context menu for one resolved component.

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

The follow-up visual, styles/templates and animation batch passed 172 tests, including source VM, direct CIL and existing reload/reassembled execution paths. Previously unset adaptive Canvas, Grid and wrap properties were exercised entering and leaving states, with exact local-state assertions. This follow-up did not run global or browser gates. Chrome for Testing 153.0.8010.12 was found in the execution environment and its executable/shared-library availability was verified for later integration qualification. The full repository check needs shared A18 test-manifest registration. No new visual-owned source file exceeds the declared source limits.

### Attached setter cost

Run `node --expose-gc packages/designer/examples/benchmark-attached.mjs` to execute 1,000 Canvas.SetLeft calls per sample on the real managed engines. The recorded run uses 20 warmups and 81 measured samples, excludes compiler/VM construction time, and performs optional host GC before each sample. The baseline runtime in detached worktree commit `e328f265` has the same platform/styling files as the visual branch before the attached-property follow-up.

| Engine | Baseline median | Updated median | Baseline p95 | Updated p95 |
|---|---:|---:|---:|---:|
| Source VM | 4.418 ms | 4.859 ms | 11.883 ms | 10.849 ms |
| Direct CIL | 19.112 ms | 18.988 ms | 29.273 ms | 22.582 ms |

Hardware/runtime: Linux x64, AMD EPYC 9V74, Node v24.19.0. These are shared-environment microbenchmarks with visible run-to-run variation, so the lower p95 figures are not a speedup claim. The source median increased about 10%, or 0.441 ms per 1,000 setters. This exceeds CONTRIBUTING's 5% performance budget and requires explicit PR review/sign-off. The correctness cost provides target ownership and layout/Int32 validation plus accurate local-versus-unset state; successful target validation is cached per heap record, redundant local markers are not written, and clearing an already-unset value does no work. This measurement does not qualify the browser's 16 ms interaction budget.
