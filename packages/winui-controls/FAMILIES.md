# Control families and application services

These public models and injectable renderer contributions are imported through `@sharpforge/winui-controls`. Managed host integration is supplied by later declared predecessors and never inferred from a pure model test.

## Family registration policy

`defaultControlTemplates`, `defaultControlTemplate`, `materializeDefaultControlStyle` and `controlVisualStates` describe actual named visuals, template bindings and per-instance states. Button style padding is applied once by managed layout. Unknown controls receive no fabricated template. Renderer registration preserves caller ownership and explicit override policy; capability requests remain host-owned.

## Commands, accelerators and icons

`XamlUICommand`, `StandardUICommand`, `commandCanExecute` and `executeCommand` share command policy. `KeyboardAcceleratorRouter` waits for Handled decisions before default invocation. `partitionCommandBar` and `commandBarGeometry` preserve source order and explicit priority groups. Icon elements/sources validate glyphs and use the declared font fallback policy.

## Media and platform policy

`MediaPlayerSession`, `WebViewSession`, `PlatformControlSession` and `InkStrokeModel` own playback/navigation epochs and release late device attachments. Playback uses an actual media element; WebView2 is a sandboxed iframe profile. Map/capture/animated visuals require explicit adapters and grants.

## Image sources and bitmap identity

`BitmapImage`, `resolveImageSource`, `drawNineGrid` and `personInitials` share image intent and decoding policy. `WriteableBitmap` is the rendering package class itself. Its dimension range diagnostic is SFRENDER001, while invalid pixel budgets or byte lengths use SFRENDER063; managed SetPixels retains its own SFUI16B2 boundary.

## Qualification

The complete A16 scope gate ran at d91e0817: 373 tests, 339 passed and 34 failed. Each publication manifest identifies its recorded cases and subsequent repairs; failures remain visible. Required core is pending on each exact publication tree. Native WinUI oracle, browser IME, codec, OS permission and performance evidence are separate qualifications. No speedup or native parity is claimed without a recorded measurement.
