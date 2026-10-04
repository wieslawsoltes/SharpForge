# A17 composition scope: implementation and acceptance evidence

This inventory covers the composition agent's assigned Project14 scope. Implementation and
authored checks were completed before grouped execution. Drawing, geometry, native text
shaping, and control-renderer work comes from the rendering worktree and has its own inventory.
Keep acceptance items open when the required browser, native, physical-device, or exact
publication-tree evidence is still unavailable.

## Observed software evidence

The complete A15/A16/A17 integration gate at `a41a1767` ran 1,338 tests: 1,320 passed
and 18 failed. Four failures belonged to the new composition/animation fixtures: numeric
input arrays were retained by reference, two isolated adapter fixtures omitted the managed
wrapper boundary, and a sparse-timeline fixture used an undefined property-source name.
Commit `24d6bff1` repairs those cases. One limiter-scoped diagnostic selected exactly those
four recorded failures; all four passed. No independent full suite was rerun.

The integrated gate and bounded diagnostic are separate evidence. Required core on each
exact publication head remains pending or is recorded on its PR; the repair diagnostic
does not substitute for those checks. The integration log is
`artifacts/results/project14/complete-repaired-epics-failures.json`; the bounded repair log is
`artifacts/results/project14/a17-final-regression-diagnostic.log`. Neither run supplies browser
pixels, reviewed backend goldens, native WinUI captures, or physical GPU measurements.

## Composition and animation

| Issue / work ID | Implemented behavior and check | Remaining acceptance evidence |
| --- | --- | --- |
| #1966 / T07.1 | Compositor, visual hierarchy, ownership, placement, content ranges; `a17-composition` | Exact publication core and browser matrix |
| #1967 / T07.2 | ElementCompositionPreview, child overlays, translation, host bridge; composition/transport tests | C# overlay and layout-counter fixture |
| #1968 / T07.3 | Color, gradient, surface, nine-grid, mask, backdrop brushes; corpus and graph tests | Native oracle images and browser matrix |
| #1969 / T07.4 | Shapes, geometry trim, typed dash collection/caps, retained invalidation | Sampled trim/reference and browser results |
| #1970 / T07.5 | Inset/rectangle/geometric clips, retained child layers and placement reuse | Browser pixel matrix |
| #1971 / T07.6 | Seven bounded effect graph types; CPU/GPU execution, unknown graph rejection | Native images for each supported effect |
| #1972 / T07.7 | Explicit unsupported lighting/material policy and deterministic diagnostics | Exact publication core; no 3D-light claim |
| #1973 / T08.1 | Typed timelines and linear/discrete/easing/spline frames; 20-sample corpus | Exact publication core and captured native traces |
| #1974 / T08.2 | Eleven easing families and cubic Bezier sampling share one implementation | Exact publication core and native/reference comparisons |
| #1975 / T08.3 | Qualified/nested property paths; complete validation before Begin | Exact publication core for subclass/property-path cases |
| #1976 / T08.4 | Typed compositor keyframes, controllers, direction/repeat/stop, snapshots | Exact publication core for sampler/controller cases |
| #1978 / T08.5 | Bounded expression parser/evaluator; live typed property references | Exact publication core for expression and negative cases |
| #1979 / T08.6 | Implicit collections, groups, scoped batches, one completion | Exact publication core for cancellation/completion cases |
| #1980 / T08.7 | Theme/implicit lifecycle, navigation hooks, injected reduced-motion gates | Exact publication core for lifecycle/environment cases |
| #1981 / T08.8 | Connected snapshots, overlay transforms, navigation cancellation | Native/reference capture provider and navigation run |
| #1982 / T08.9 | Data-only independent definitions, private animation slot, one completion | Exact publication core for VM/JS/worker integration |

`a17-composition-graph-safety` additionally covers atomic graph preflight, typed entries,
resource dependencies, cycles, geometry/image transfer, surface loading, and rewind cleanup.
`a17-composition-gc` covers weak app tracking and owner leases. Managed source owners are
rooted by actual attached/active ownership, not by every call to GetElementVisual.

The seven effect types are GaussianBlur, Saturation, Blend, ColorSource, Opacity,
ArithmeticComposite, and Tint. Blend accepts SourceOver, Multiply, Screen, and Add.
Effect graphs are limited to 64 nodes/16 levels. Blur is at most 64 DIPs, scales with DPR,
and uses bounded sample counts. Unsupported graph kinds fail at factory creation.
Animating named effect properties and HSL interpolation are explicit unsupported surfaces.
Lighting APIs produce `SF_RENDER_LIGHT_UNSUPPORTED`; no fake illumination is rendered.

## Resource lifetime and frame performance

| Issue / work ID | Implemented behavior and check | Remaining acceptance evidence |
| --- | --- | --- |
| #1983 / T09.1 | App device, buffer/texture pools, retained analytic storage | Measured steady-frame JS allocations and exact publication core |
| #1984 / T09.2 | Delta uploads and live analytic plan updates; one of 10k = one 128-byte instance | Exact publication core and physical benchmark |
| #1985 / T09.3 | Submission tickets, deferred retirement, pinned plans/caches, loss epochs | Exact publication core and browser resize/dispose/loss matrix |
| #1986 / T09.4 | Idempotent surface cleanup, shared-service ownership, 1,000-surface test | Exact publication core and measured browser leaks |
| #1987 / T10.1 | One scheduler with ordered phases, injected clocks, paused/idle behavior | Exact publication core for scheduler/host cases |
| #1988 / T10.2 | Preserved-target damage/scissor, old/new bounds, full-redraw escalation | Exact publication core and browser damage evidence |
| #1989 / T10.3 | Local-size static raster cache, placement reuse, resource invalidation, LRU pins | Browser scroll/reuse and memory measurement |
| #1990 / T10.4 | CPU submit, queue completion, dropped frames, input/present estimate distinction | Exact publication core and real timing samples |

The API recording GPU and Canvas fixtures validate calls, identity, retirement, and budgets.
They do not compile WGSL, rasterize reference pixels, or qualify a physical adapter.
The `a17-webgpu-retention`, `a17-damage-layer-cache`, `a17-frame-lifecycle`, and
`a17-surface-lifecycle` files contain the focused lifetime/performance assertions.
Actual zero-allocation browser evidence and before/after CPU measurements are still required;
no speedup or zero-allocation claim is inferred from retaining the same JavaScript object.

## Numeric glyph rendering delegated from the drawing workstream

| Issue / work ID | Implemented behavior and check | Remaining acceptance evidence |
| --- | --- | --- |
| #1947 / T04.2 | Font/version/size/DPR/phase atlas keys, bounded residency and metadata, LRU generations, pins, dirty uploads | Exact publication core and physical memory observations |
| #1948 / T04.3 | Retained 80-byte instanced glyph quads, per-span solid tint, intrinsic RGBA, decorations, linear working color | Actual 10–72 DIP Canvas comparisons and GPU shader/browser matrix |

The numeric path consumes real positioned glyph IDs from the peer's HarfBuzz provider.
It does not count complete native-run image tiles as numeric glyphs. Unchanged plans retain
their atlas residency and instance buffers; modified numeric runs rebuild their instance
plan while retaining reusable glyph rasters. Analytic rectangle delta uploads do not imply
numeric glyph delta updates. Pending color decodes never enter the empty-glyph cache.
See `packages/rendering/docs/glyph-rendering.md` for units, lifetime, limits and fallback policy.

## Qualification and corpus

| Issue / work ID | Implementation checkpoint | Evidence unavailable at authoring |
| --- | --- | --- |
| #1991 / T11.1 | Actual Chromium/Firefox/WebKit/Safari drivers, readback/screenshots, failure artifacts | Every real browser run |
| #1992 / T11.2 | Manual software-WebGPU workflow and strict adapter/baseline gate | Real software capture, reviewed goldens, workflow result |
| #1993 / T11.3 | Vendor/tier/driver inventory and hardware run instructions | Intel, AMD, NVIDIA, Apple reports and screenshots |
| #1994 / T12.1 | Graphics/default-template corpus, PNG/diff tool, explicit baseline update | Captured backend goldens and native control references |
| #1995 / T12.2 | Manual-clock mathematical trace goldens and tolerance failures | Exact publication core and captured native traces |
| #1996 / T12.3 | Median/p95/p99, draw/memory/atlas budgets and matched 5% regression gate | Baseline and current hardware/software measurements |

No native GPU, vendor pass, default-template parity, or native trace pass is claimed.
Backend reference images cannot be fabricated from mock GPU buffers. Missing real baselines
fail the workflow until the completed scope is captured and the resulting files are reviewed.

## Studio integration added for this scope

`StudioUIHostBridge` shares one FrameScheduler between the host and transported composition.
It handles session reset, debug pause, bounded private values and requests, completion tokens,
input/collection/layout/virtualization/automation routing, and browser-owned overlays.
Host operations use explicit allowlists. Clipboard/launcher/window capabilities require
configured control services. Opaque dropped-file tokens resolve through the private broker;
DOM Files never cross the generic scene channel. `assertUIHostData` is shared with the worker.

The browser bridge tests cover stale sessions, private values, cancellation, unsupported host
requests, routed input, and file-drop capability delegation. They passed in the completed integrated software gate; exact publication-head checks remain
separate. Snapshot callbacks and managed array writes rely on the shared
ManagedUIContext hooks integrated by the parent worktree.
