# @sharpforge/winui

Reusable browser host and independent JavaScript facade for the SharpForge WinUI-shaped API subset.

Exports WinUIHost, RenderSurface, createWinUIApp, primitiveShader and frameworkManifest. Include the exported CSS stylesheet when embedding. WinUIHost consumes bounded commands from the managed runtime and returns input events; it does not execute C# text or use eval. createWinUIApp offers equivalent supported constructors under namespaced JavaScript objects.

Common controls use DOM layout, native input and browser text. Drawing uses a real WebGPU instanced primitive pipeline where available; Canvas2D and DOM backends are explicit fallbacks. A hybrid renderer is not a full GPU WinUI compositor. No native Windows App SDK/WinRT/XAML, complete template/binding system, arbitrary Windows assemblies or pixel-exact WinUI equivalence is claimed.

The source distribution includes four runnable C# UI examples and independent JavaScript browser tests. Canvas2D pixels, DOM fallback and unavailable-WebGPU negotiation are tested in this release; physical WebGPU adapter/device-loss behavior requires hardware qualification.

## Retained geometry updates

`host.tryPatchProperties([{id, properties: {Left: 80, Width: 200}}])` applies geometry values to existing, absolutely positioned
Canvas leaves. A property value of `undefined` clears that property. It returns `true` after staging the whole batch, then
`host.flush()` renders and measures only the affected controls. The batch is limited to 10,000 node records and rejects
malformed input. No model validation or C# execution occurs in the host; callers supply validated scene values.

It returns `false` without changing any node if full dependency processing is required: flowing parents, visual children,
templates, drawing shapes, nongeometry properties, or a pending full scene update. The caller then uses its ordinary complete
scene/command path. `host.sceneRevision` changes after scene content updates, including `load`, `merge`, `apply` and a retained
property patch. Pure viewport/size observation does not change it. Consumers must also track their model revision and preview
environment; object identity alone is not proof that a mutable model is unchanged.

Position-only updates of fixed-size leaves retain their last complete layout origin and apply the new offset before the
existing two-dimensional transform. Authoritative `Left` and `Top` values are updated immediately; after `flush()`, actual DOM
bounds and native hit testing reflect those coordinates. CSS `left` and `top` may still describe the retained layout origin.
The host still measures every affected control synchronously and reports real size changes through `onLayout`.

Offsets are always relative to that origin, so repeated moves and undo/redo do not accumulate translation error. The original
transform and origin are preserved, including transformed Canvas parents. Size, geometry-style, scene, backend and structural
changes reset this representation through the ordinary renderer. Unset dimensions, three-dimensional transforms, independent
CSS transform properties, motion paths and CSS animations/transitions keep the ordinary node-render path. A rejected
multi-node batch changes neither properties nor retained translation records.

The retained renderer verifies the effective computed transform before measuring. If a stylesheet overrides the inline
composition, including an identity `!important` transform, it immediately renders the node with canonical `left` and `top`.
Computed transform serialization outside the conservative tolerance also chooses that fallback. Geometry measurements and
native input never depend on an inline transform that failed to take effect.

## 0.13 playback and wrapping

The JS facade includes Storyboard/DoubleAnimation, duration/repeat/easing types, transforms and wrapping panels. Default application playback uses requestAnimationFrame. Set `animationManual: true` on `createWinUIApp` and call `app.advanceAnimations(milliseconds)` for deterministic tests. `app.dispose()` cancels the clock and detaches the host. Animated values overlay local/style bases; Stop restores the latest base. Transformed drawing primitives use DOM fallback rather than rendering an incorrect untransformed GPU primitive. Wrap panels use CSS grid and are not virtualized native WinUI layouts.
