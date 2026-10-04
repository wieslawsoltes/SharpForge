# Responsive environment contract

`EnvironmentState`, `BrowserEnvironmentObserver`, `TextScalePolicy`,
`environmentLayoutProperties`, `createContextEnvironment`, and
`validateEnvironmentSnapshot` are exported by `@sharpforge/winui-controls`.
`registerLayoutContracts` and `registerLayoutAdapters` include the environment
contributions. A host/session owns its environment; there are no global listeners.

## Host and worker integration

`host.services.environment` exposes `RootId`, `ContentId`, `RasterizationScale`,
`Size`, `IsHostVisible`, `TextScaleFactor`, `HighContrast`, `HighContrastScheme`,
`AnimationsEnabled`, `TouchMode`, `DarkTheme`, and `InputPaneOccludedRect`.
`Size` has `Width`/`Height`; the rectangle has `X`/`Y`/`Width`/`Height`. All geometry
uses DIPs relative to the browser host. Scale is physical pixels per DIP.

`state.subscribe(callback)` returns a disposer. A notification contains
`{changed, previous, current}` and fires once after an atomic update. Unchanged
values do not notify. `snapshot()` returns cloneable version-1 data with a
monotonic `revision`; `validateEnvironmentSnapshot` checks this protocol.
Unknown fields, invalid booleans, non-finite dimensions, negative sizes, identities
longer than 512 code units and scheme names longer than 256 code units are rejected.
Rasterization scale is bounded to `[0.0625, 16]`, text scale to `[0.5, 8]`, and
coordinate magnitude to 10 million DIPs. There are at most 20,000 subscriptions.

`WinUIHost` publishes `options.onEnvironmentSnapshot(snapshot)`. A worker must
deliver that data to `context.services.environment.updateFeedback(snapshot)`;
`createContextEnvironment(context)` installs the DOM-free default before managed
layout. The Studio message is `uiEnvironmentSnapshot` with `{snapshot}`. Browser
JavaScript uses the host's same environment instance and `services.inputPane`.
Snapshots restore silently, preserving subscriptions and debugger event ordering.

Resource scopes subscribe to the environment and call their existing
`setSystemTheme(DarkTheme ? 'Dark' : 'Light', HighContrast)` operation. This keeps
the resource dictionary's HighContrast branch and element RequestedTheme rules
together. `services.systemColors(name)` resolves actual browser system colors to
CSS `rgb`/`rgba` values for retained drawing. Its bounded cache clears when the
system theme/contrast changes. Scoped native-input CSS retains system colors and
a visible focus outline in forced-color mode.

## Public projections and behavior

The additive public contracts include `UIElement.XamlRoot`, the XamlRoot
geometry/visibility properties and Changed event, `UISettings.TextScaleFactor`
and `AnimationsEnabled` with their events, `AccessibilitySettings.HighContrast`
and `HighContrastScheme`, and `InputPane` occlusion/visibility events and
`TryShow`/`TryHide`. Settings objects keep their own event subscriptions and
unsubscribe on managed-owner disposal. XamlRoot references are stable per host;
a detached element starts with `null`, and an explicitly assigned root must
belong to the same context. The current browser profile has one XamlRoot per
browser host, including its logical windows and detached overlays.

DPR changes use a resolution media query, window resize and a root
ResizeObserver. They invalidate arrange rounding without multiplying font sizes.
Text scaling changes managed measurement, native font sizes, and the rendering
service's shared text policy; `IsTextScaleFactorEnabled=false` opts an element out.
The browser does not expose the Windows text-size preference. Hosts supply it
through `host.environment.setTextScaleFactor(factor)` or an injected
`TextScalePolicy`; the default is 1. This profile uses linear scaling, while the
Windows setting has a documented 1–2.25 range and non-uniform behavior for larger
text. The broader bounded host range is a SharpForge extension, not a claim of
native text-metric equivalence.

Touch mode comes from the browser's coarse-pointer signal or touch capability.
Interactive element constraints and native input parts receive 40-DIP minimum
targets. This is an effective layout policy: stored Width, Height, MinWidth and
MinHeight values are unchanged. Virtualized control families use the same touch
policy for automatic row estimates; explicitly supplied item sizes remain explicit.

Reduced-motion uses the actual browser preference. Theme, implicit, and connected
animation services check `AnimationsEnabled` at start and cancel active policy
transitions when it turns false. Application-created storyboard/compositor clocks
remain independently controlled by the application.

InputPane uses actual `navigator.virtualKeyboard.boundingRect` geometry and
intersects it with the transformed host. It does not infer a keyboard from browser
zoom, address-bar changes, or guessed viewport thresholds. Browsers without that
capability expose an empty occlusion rectangle; a platform adapter may supply
another explicit capability. `TryShow`/`TryHide` return whether a supported
synchronous browser request was accepted, not whether a keyboard became visible.
Worker contexts without a synchronous keyboard capability return false.
In-process Showing handlers can set `EnsuredFocusedElementInView` before the
default focus-scroll microtask. Worker notifications follow the browser geometry
change and cannot prevent an already executed browser scroll. Floating keyboards
and native Windows pre-animation timing require platform qualification.

## Authored acceptance fixtures

`tests/a16-layout-environment.test.js` covers protocol validation, independent
scale factors, silent restore, transformed occlusion, touch layout and disposal.
`tests/a16-environment-managed.test.js` covers the typed source/reloaded/CIL
settings projection and explicit absent-keyboard result. The full browser control
suite covers responsive geometry, forced-color/native focus and live text scale.
These fixtures are authored; execution is deferred until the full epic scope is
integrated, per the project request. Native Windows equivalence is not asserted.

Contract references: Windows App SDK 1.8
[UIElement.XamlRoot](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.uielement.xamlroot?view=windows-app-sdk-1.8),
[XamlRoot](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.xamlroot?view=windows-app-sdk-1.8),
and Windows SDK 10.0.26100
[UISettings](https://learn.microsoft.com/en-us/uwp/api/windows.ui.viewmanagement.uisettings?view=winrt-26100),
[text scale](https://learn.microsoft.com/en-us/uwp/api/windows.ui.viewmanagement.uisettings.textscalefactorchanged?view=winrt-26100),
[InputPane](https://learn.microsoft.com/en-us/uwp/api/windows.ui.viewmanagement.inputpane?view=winrt-26100),
[AccessibilitySettings](https://learn.microsoft.com/en-us/uwp/api/windows.ui.viewmanagement.accessibilitysettings?view=winrt-26100).
