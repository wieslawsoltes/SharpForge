# @sharpforge/winui

Reusable browser host and independent JavaScript facade for the SharpForge WinUI-shaped API subset.

Exports WinUIHost, RenderSurface, createWinUIApp, primitiveShader and frameworkManifest. Include the exported CSS stylesheet when embedding. WinUIHost consumes bounded commands from the managed runtime and returns input events; it does not execute C# text or use eval. createWinUIApp offers equivalent supported constructors under namespaced JavaScript objects.

Common controls use DOM layout, native input and browser text. Drawing uses a real WebGPU instanced primitive pipeline where available; Canvas2D and DOM backends are explicit fallbacks. A hybrid renderer is not a full GPU WinUI compositor. No native Windows App SDK/WinRT/XAML, complete template/binding system, arbitrary Windows assemblies or pixel-exact WinUI equivalence is claimed.

The source distribution includes four runnable C# UI examples and independent JavaScript browser tests. Canvas2D pixels, DOM fallback and unavailable-WebGPU negotiation are tested in this release; physical WebGPU adapter/device-loss behavior requires hardware qualification.

## 0.13 playback and wrapping

The JS facade includes Storyboard/DoubleAnimation, duration/repeat/easing types, transforms and wrapping panels. Default application playback uses requestAnimationFrame. Set `animationManual: true` on `createWinUIApp` and call `app.advanceAnimations(milliseconds)` for deterministic tests. `app.dispose()` cancels the clock and detaches the host. Animated values overlay local/style bases; Stop restores the latest base. Transformed drawing primitives use DOM fallback rather than rendering an incorrect untransformed GPU primitive. Wrap panels use CSS grid and are not virtualized native WinUI layouts.
