# @sharpforge/rendering

Application-owned retained drawing services for SharpForge. The package registers no global mutable state and accepts platform resources through explicit owners.

## Resource ownership

`ResourceTable` rejects stale, foreign and mistyped handles, retains mutable resource versions and delays disposal until the final GPU submission completes. `DeltaUpload` keeps bounded typed storage and uploads only changed aligned ranges.

## Drawing lists

`DrawingContext` records shape, image, text and layer commands in DIP coordinates. `DisplayList` seals immutable snapshots, validates its versioned wire envelope, replays through an injected adapter and diffs retained element versions. Opaque platform objects require resource handles before serialization.

## Retained delegates and transforms

`RenderDelegateRegistry` resolves contributions through declared base types. `DisplayListTreeBuilder` preserves content through placement changes and reports unsupported visuals. Released rectangles, elliptical radii, stroke-only shapes and line commands lower into the same drawing list. Affine helpers define composition order and singular-inverse handling.

## Brushes and images

Solid, linear and radial brushes share explicit color, opacity, transform, interpolation and spread rules. `ImageCache` owns decoded images through cancellation and eviction. `WriteableBitmap` snapshots its exact pixel storage and publishes invalidation. Image fitting and nine-grid placement preserve the requested source rectangle and alignment.

## Path geometry

`parsePath` normalizes relative and absolute SVG-style commands, arcs and smooth controls into immutable geometry. Geometry bounds include transformed curve extrema. Flattening uses target-space error tolerance; fill hit testing preserves winding rules and rejects malformed or cyclic descriptors.

## Fills, strokes and painted bounds

Scanbeam tessellation preserves holes and self-intersections. Strokes preserve dash seams, cap dots, joins and explicit work/vertex budgets. Painted bounds include transforms, stroke extent, glyph overhang and conservative shadow/effect expansion.

## Composition state

`CompositionObject` and `CompositionPropertySet` keep native state under an explicit application owner. Typed getters distinguish missing values and type mismatches; quotas, immutable inputs, animated/base precedence, snapshots and disposal are enforced before a visual tree is attached.

## Composition brushes and effects

Retained brush descriptors preserve owned color stops, interpolation space, masks, surfaces and effect sources. The supported effect subset evaluates premultiplied RGBA, scales blur in DIPs at the supplied DPR and rejects unsupported nodes, invalid graphs and resource cycles. Scene lighting and animatable effect-node properties return explicit unsupported diagnostics.

## Typed drawing resources

`DrawingModel` and `DrawingCollection` retain explicit native state and snapshots. Resource descriptors materialize according to the declared CLR type; Point, Size, Rect and Matrix cross value boundaries as flat typed fields, while scene geometry and brushes retain their property descriptors. Browser system backdrops report their approximation policy.

## Shared brush rasterization

Canvas, SVG and reported GPU fallbacks share bounded pixel-center brush sampling and premultiplied effect conversion. Complex masks, nine-grid brushes and authorized backdrops use the same ownership and color-space policy. Missing backdrop access reports the selected fallback explicitly.

## Frames and retained caches

`FrameScheduler` coalesces work in explicit input/layout/animation/build/submit/present phases. Debug pause freezes animation time while layout and painting remain available. `DirtyRegions` requires preserved contents before partial redraw; `LayerCache` excludes placement from reusable local content. `FrameMetrics` separates CPU submission, GPU completion and presentation.

## Text layout services

`TextLayoutService` caches actual provider results and shares them with measurement and drawing. The browser provider retains shaped native runs with explicit opaque glyph access. Cluster maps drive caret, hit testing and selection; rich spans, trimming and ink bounds remain separate from raster policy. Numeric portable shaping is supplied by a separate provider.

## Canvas2D replay

`Canvas2DBackend` executes the complete drawing command ABI with balanced transforms/clips, transparent stroke-only geometry and the chosen working color space. Cached layer pixels remain local to their content; placement changes reuse them. Partial redraw first clears the damaged interior while preserving pixels outside it.

## Device lifetime

`GpuDevice` coalesces acquisition for surfaces owned by one app, publishes loss/recovery epochs and owns per-epoch pipeline caches. Buffer and texture pools publish reusable leases only after submission retirement has cleared. Borrowing surfaces do not dispose the shared device.

## Glyph and texture residency

`GlyphAtlas` bounds live glyph metadata and raster pages, preserves pages pinned by retained plans, and distinguishes font version, size, density and subpixel phase. Dirty shelves upload incrementally; first residency and recovery upload the full texture. Empty glyphs preserve advances and pending decodes are retried.

## GPU pipelines

Vector, analytic rectangle/ellipse and glyph pipelines share explicit premultiplied working-color semantics. App-owned per-epoch caches distinguish render/presentation formats and sample counts. Compilation errors are surfaced and failed promises are evicted so a later retry can recover.

## GPU mesh encoding

`MeshBuilder` reuses the shared fill/stroke geometry and image/brush policy. Eligible solid primitives pack analytic instances; other shapes retain exact meshes or explicit raster fallback. Numeric glyphs pack measured origin, atlas coordinates, color and opacity without reshaping or guessing glyph IDs.

## GPU effects and local rasters

Effects allocate explicit pooled targets and uniforms with submission retirement. Gaussian blur scales DIP radius by the actual surface density. Local raster cache entries exclude placement from their keys and pin plans while referenced; backdrop-dependent content bypasses static caching. Capability selection returns a concrete backend and reason for every operation.

## Retained GPU rendering

`WebGpuBackend` compiles ordered plans, reuses unchanged buffers and uploads only changed analytic instance ranges. Stencil clips and MSAA preserve painter order. Partial redraw replaces damaged pixels before replay; cached local layers survive placement changes. Readback and metrics expose the actual target, uploaded bytes, resource memory and explicit fallbacks.

## Validation

Focused cases were authored and included in the completed A17 scope gate. The publication manifest records its exact prior evidence and any subsequent repair. Required core is pending on this exact branch tree. Browser pixels, native WinUI comparisons and physical GPU qualification are separate gates.
