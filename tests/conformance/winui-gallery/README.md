# WinUI Gallery property conformance

Task: SF-A29-T26 (#496).

`upstream.json` pins microsoft/WinUI-Gallery at
`535ce178dbd6ebe24fe63e444b66344d007bdabe`. It indexes all 125 sample pages and
records the SHA-256 and byte length of the unmodified XAML and C# pages imported
for ten controls. `upstream/LICENSE` is the upstream MIT license. No Gallery
images, fonts, assets, or packages are imported. Original files are test data,
never compiled as part of SharpForge.

`fixtures.json` describes 20 ported XAML/C# cases and three negative XAML cases.
Ports remove Gallery-specific wrappers, resources, event handlers and x:Bind.
The isolated controls preserve the simple property examples; boundary variants
(empty text, disabled/unchecked controls, zero width, and range endpoints) are
explicit SharpForge extensions. These fixtures do not claim event, layout,
rendering, accessibility or full-page coverage.

The C# fixtures execute through the public compiler and source/CIL VM APIs.
No DOM substitute or simulated Windows result is used. XAML loading, browser
rendering, and Rust WinUI execution have no adapter in this suite and are reported
as unsupported. `STATUS.md` records the initial per-page coverage inventory.
The report command regenerates a per-page status table with observed results.

The Button CIL baseline currently exposes `IsEnabled` as integer `1` instead of
boolean `true`. The adapter preserves this raw value and exact comparison rejects
it; the focused test records the mismatch, not CIL property parity. This product
gap remains open alongside the pending native capture. Adapted fixtures omit
unused `Controls.Primitives` imports; ToggleButton retains its required import.

## Commands

Run from the repository root with Node 24 and the repository workspace links:

```sh
node --test --test-concurrency=1 tests/conformance/winui-gallery/gallery.test.js
node scripts/conformance/winui-gallery/report.js
```

On Windows x64 with an interactive desktop, use the **existing** SDK 10.0.201,
CoreCLR 10.0.5 and Windows App SDK 1.8.260921001 oracle environment described in
`planning/qualification/oracles.md`. Capture uses its existing csproj, package
lock, NuGet.Config and image checks; no new package dependency is introduced.

```sh
node scripts/conformance/winui-gallery/capture.js artifacts/results/gallery-windows.json
node scripts/conformance/winui-gallery/report.js artifacts/results/gallery-windows.json
```

The capture host instantiates each fixture through both real `XamlReader.Load`
and its C# factory. It records exact property values or exception types, repeats
capture twice, and refuses nondeterministic or inconsistent XAML/C# results.
Input identity includes the upstream commit, both source hashes, fixture
metadata and the native host hash. The report rejects stale, incomplete,
duplicate, wrong-target and wrong-toolchain dumps. It compares rejection versus
acceptance, and exact property values for accepted cases; exception class names
are retained but not equated across runtimes.

No Gallery-specific Windows dump has been captured in this batch. The existing
small WinUI oracle dump covers a different input and cannot qualify these
fixtures. Without this suite's dump, observed source/CIL values are explicitly
`missing-oracle`. The issue remains open until the remaining platform and
control qualification is complete.

To reproduce the source import, obtain the pinned commit from the repository
URL in `upstream.json`, copy only the listed files below `upstream/`, and verify
all recorded SHA-256 digests. The page index records each upstream Git blob ID,
including pages not ported; a small selected subset is never represented as
complete Gallery coverage.
