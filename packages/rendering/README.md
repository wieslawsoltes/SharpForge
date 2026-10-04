# @sharpforge/rendering

Application-owned retained drawing services for SharpForge. The package registers no global mutable state and accepts platform resources through explicit owners.

## Resource ownership

`ResourceTable` rejects stale, foreign and mistyped handles, retains mutable resource versions and delays disposal until the final GPU submission completes. `DeltaUpload` keeps bounded typed storage and uploads only changed aligned ranges.

## Composition state

`CompositionObject` and `CompositionPropertySet` keep native state under an explicit application owner. Typed getters distinguish missing values and type mismatches; quotas, immutable inputs, animated/base precedence, snapshots and disposal are enforced before a visual tree is attached.

## Composition brushes and effects

Retained brush descriptors preserve owned color stops, interpolation space, masks, surfaces and effect sources. The supported effect subset evaluates premultiplied RGBA, scales blur in DIPs at the supplied DPR and rejects unsupported nodes, invalid graphs and resource cycles. Scene lighting and animatable effect-node properties return explicit unsupported diagnostics.

## Drawing lists

`DrawingContext` records shape, image, text and layer commands in DIP coordinates. `DisplayList` seals immutable snapshots, validates its versioned wire envelope, replays through an injected adapter and diffs retained element versions. Opaque platform objects require resource handles before serialization.

## Retained delegates and transforms

`RenderDelegateRegistry` resolves contributions through declared base types. `DisplayListTreeBuilder` preserves content through placement changes and reports unsupported visuals. Released rectangles, elliptical radii, stroke-only shapes and line commands lower into the same drawing list. Affine helpers define composition order and singular-inverse handling.

## Path geometry

`parsePath` normalizes relative and absolute SVG-style commands, arcs and smooth controls into immutable geometry. Geometry bounds include transformed curve extrema. Flattening uses target-space error tolerance; fill hit testing preserves winding rules and rejects malformed or cyclic descriptors.

## Visual and shape models

Visual collections enforce ownership, parent identity and cycle/depth limits. Typed shapes, clips, dash collections and drop-shadow descriptors preserve snapshots and invalidate owned content. Transforms are in DIPs; the 2D rendering boundary reports unsupported 3D transforms explicitly.

## Typed animation values

`prepareValueAnimation` and `sampleValueAnimation` implement typed interpolation and discrete keyframes. Easing bounds and complete property-path validation fail before mutation. `buildTimelineDefinition` accepts explicit adapters, including endpoint-presence checks for omitted values.

## Composition animation definitions

Keyframe definitions capture values and validated easing plans. Expressions read only supplied parameters and documented typed members through a bounded interpreter. Definitions, groups, implicit collections and batches have explicit owner and snapshot contracts.

## Shared clock

The framework continues to export `AnimationClock` through its existing entry point. It imports typed samplers from this package and is injected into composition; rendering never imports the framework. The trace fixture states its sample tolerance and covers deterministic timeline behavior.

## Compositor playback

`Compositor` builds retained display lists and layer handles, avoiding geometry re-encoding for placement-only changes. Controllers and expressions run on the injected shared clock. Public stop policies remain distinct from internal transient-base restoration. Collection wrappers retain newly added managed children and release removed items through their existing mutation receiver.

## Element previews and transient transitions

`ElementCompositionPreview` keeps visual state relative to the arranged element and owns explicit hand-in/hand-out leases. Theme and implicit coordinators use stable owner identities, obey reduced motion and restore the underlying base on completion/cancellation. They reuse the compositor clock and do not replace managed local-value slots.

## Connected navigation

`ConnectedAnimationService` owns at most 32 prepared captures and releases each on completion, cancellation or expiry. Navigation transitions use destination layout and reduced-motion policy; capture and overlay services are explicit requirements, and unavailable retained captures fail clearly.

## Composition contract and adapter registration

`registerCompositionContracts` adds the typed surface through the caller’s reserved registry; `ensureNumericsContracts` preserves existing value definitions. `registerCompositionAdapters` accepts the shared native/managed context. TryGet methods use actual out references, and dash CopyTo/GetMany use managed array hooks so conversion and rewind notifications remain observable. No global framework registry is changed at package import.

## Brushes and images

Solid, linear and radial brushes share explicit color, opacity, transform, interpolation and spread rules. `ImageCache` owns decoded images through cancellation and eviction. `WriteableBitmap` snapshots its exact pixel storage and publishes invalidation. Image fitting and nine-grid placement preserve the requested source rectangle and alignment.

## Fills, strokes and painted bounds

Scanbeam tessellation preserves holes and self-intersections. Strokes preserve dash seams, cap dots, joins and explicit work/vertex budgets. Painted bounds include transforms, stroke extent, glyph overhang and conservative shadow/effect expansion.

## Typed drawing resources

`DrawingModel` and `DrawingCollection` retain explicit native state and snapshots. Resource descriptors materialize according to the declared CLR type; Point, Size, Rect and Matrix cross value boundaries as flat typed fields, while scene geometry and brushes retain their property descriptors. Browser system backdrops report their approximation policy.

## Composition graph transport

`serializeCompositionGraph` emits only bounded data and explicit object identities. `applyCompositionGraph` checks kinds, property types, ownership, roots, cycles and effect sources before committing. It preserves existing object/content identities on placement changes and transports geometry, decoded images and stroke dash collections without executable callbacks or host classes.

## Independent host timelines

`CompositionTransport` and `CompositionTransportHost` install definitions and native visual graphs in an explicit application session. Host frames use an injected shared animation clock and return completion identities, avoiding per-frame managed messages. Independent XAML timelines accept only supported render properties; dependent layout properties stay with managed execution. Snapshot, pause, stop, binding removal and disposal preserve ownership and restore transient base values when requested.

## Application composition services

`createCompositionServices` owns one default compositor and connects preview, implicit, theme, connected and navigation services through explicit host callbacks. Additional compositors use weak bookkeeping and do not become permanent managed roots. Host environment changes cancel convenience motion while preserving reusable service instances; app-started storyboards keep their own policy. Paint-brush transitions bind native brush descriptors and clear those bindings when complete.

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

## Portable shaping engine

`loadBundledHarfBuzz` creates an isolated engine from supplied bytes or an explicit binary loader. No provider instance or Wasm memory is shared. The pinned upstream wrapper, engine, license and provenance ship together with a licensed Latin smoke face. The caller still chooses the font collection.

## Variable font fixtures and metrics

The renamed licensed fixture families preserve real weight/width axes and distinct italic outlines. Horizontal metrics use the complete48-byte native structure instead of the pinned wrapper's undersized12-byte allocation. Font and engine hashes remain explicit.

## Multilingual fixture collection

`bundledTextFixtures` returns the pinned Latin variable, Arabic, Hebrew, Devanagari and color emoji face descriptors. The explicit emoji corpus retains GSUB closure and CBDT/CBLC data, including ZWJ sequences and skin tones. A local reproduction script records the transformations and modified family names.

## Independent shaping oracle

The checked-in glyph expectations come from raw upstream HarfBuzz calls with pinned engine and font hashes. Explicit multilingual requests retain script, direction and item boundaries. A separate capture script can reproduce these expectations without importing the portable provider, font matcher, line layout or glyph rasterizer.

## Pinned Unicode segmentation

Unicode17 property tables drive bounded extended-grapheme segmentation and script lookup. The checked-in license and provenance identify the source inputs and transformation. Segmentation keeps surrogate pairs, combining sequences, Indic conjuncts and emoji ZWJ sequences intact.

## Bidirectional text

The pinned bidi-js implementation supplies Unicode13 paragraph levels and visual ordering. The adapter expands scalar levels to UTF-16 and resets whitespace at each actual line boundary. Shaped RTL glyph arrays retain their original order within a visual item.

## Color font tables

Bounded parsers preserve palette bytes, foreground layers, bitmap strike metrics and sparse glyph indexes. PNG signatures, chunk order, CRCs and dimensions are checked before decoding. Unsupported OpenType color formats report a specific diagnostic; no substitute glyph identifiers are fabricated.

## Font matching and item shaping

`PortableFontRegistry` owns loaded faces and bounded variation instances. Complete grapheme coverage determines fallback; script, language and bidi levels determine shaping items. `HarfBuzzShaper` reuses a bounded UTF-16 allocation and returns real glyph IDs/offsets while releasing all transient input after each shaping request.

## Portable glyph rasterization

`PortableGlyphRasterizer` uses actual loaded glyph outlines or OpenType color assets. It retains phase-adjusted DIP bounds, intrinsic colors and bounded pending-image ownership. Whole-run paint and atlas consumers share these glyphs; neither path reconstructs text from character codes.

## Line opportunities

Pinned Unicode17 UAX14 rules preserve nonbreaking spaces, word joiners, explicit opportunities, CJK behavior and mandatory breaks. A caller-selected finite work budget bounds adversarial lookahead; cancellation is observed before even a short input is processed.

## Portable text provider

`createPortableTextProvider` loads only caller-authorized assets and verifies declared hashes. `HarfBuzzTextProvider` performs contextual line shaping, visual bidi placement, wrapping/trimming and exact UTF-16 cluster maps with bounded work. Actual font metrics and glyph ink bounds drive measurement; asynchronous color assets invalidate retained drawing resources when ready.

## Numeric GPU text integration

Portable shaping, atlas residency and GPU instances share exact font identities and measured glyph positions. Ready color assets invalidate reused plans and cached layers; pending images do not become permanent empty cache entries. Non-solid runs use the documented complete-run raster path. The shipped text documentation separates implemented capabilities from external qualification.

## SVG projection

`SvgBackend` preserves scoped transforms/clips and paints actual stroke geometry. Gradients retain coordinate, spread and interpolation policy. Numeric text consumes provider glyph outlines; native runs retain their measured font runs. Operations requiring shared raster semantics report the Canvas fallback.

## Rendering surfaces

`RenderSurface` selects an explicit or negotiated backend, subscribes to its app-owned resources and text service, and preserves device borrowing rules across switching and disposal. Viewport dimensions and pixel budgets are validated before allocation. A complete portable drawing example shows authorized font loading, text layout, geometry and readback.

## Independent path fixtures

The path corpus includes100 distinct valid cases, malformed syntax boundaries and pinned licensed Fluent assets. Independent SVG/Path2D capture helpers provide browser references without calling the renderer tessellator. Their presence is not recorded as executed browser pixel qualification.

## Portable qualification fixtures

The real-render fixture corpus records geometry, composition, effects, large instancing and pinned numeric text through public rendering APIs. Expected pixels require actual reviewed captures; native WinUI remains an explicit independent oracle. Control gallery activation is deferred until the full host/facade closure exists.

## Validation

The publication manifest lists authored fixtures and the prior completed-scope evidence separately. Repairs and newly authored cases await the consolidated rerun; required core is pending on this exact branch tree. Browser pixels, native WinUI comparisons and physical GPU qualification remain separate gates.
