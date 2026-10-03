# Project and item template examples

Generated deterministically by `npm run examples:templates` from the same public catalog used by Studio. Each directory is a complete .slnx/.csproj workspace. Each adjacent standard ZIP includes the exact files, empty directories, and a bounded SharpForge workspace manifest.

Open a ZIP through File → Open ZIP, or open its extracted folder. Use Add Existing Project to import one into another solution. Native Microsoft SDK builds are not asserted by this generator. WinUI examples use SharpForge's code-first web profile, not the Windows App SDK.

## Project catalog

- **console** — Console App
- **console-async** — Console App (async)
- **class-library** — Class Library
- **empty-project** — Empty C# Project
- **winui-blank** — WinUI App (code-first web)
- **winui-navigation** — WinUI Navigation App
- **winui-controls-library** — WinUI Control Library
- **test-console** — Self-test Console
- **blank-solution** — Blank Solution
- **console-library-solution** — Console + Library Solution
- **winui-library-solution** — WinUI App + Control Library

## Item gallery

The `item-gallery` library contains every supported item template with unique names. Build it as a library or reference it from an app. Code-first visual components expose a real profile control through `.View`, rather than deriving from unsupported native WinUI base classes.

- **class** — Class
- **partial-class** — Partial Class
- **static-class** — Static Class
- **disposable-class** — Disposable Class
- **view-model** — View Model
- **winui-page** — WinUI Page
- **winui-counter-page** — WinUI Counter Page
- **winui-grid-page** — WinUI Grid Page
- **winui-settings-page** — WinUI Settings Page
- **winui-user-control** — WinUI User Control
- **winui-custom-control** — WinUI Composite Control
- **winui-window** — WinUI Window
- **winui-flyout** — WinUI Menu Flyout
- **winui-resources** — WinUI Brush Factory
- **text** — Text File
- **json** — JSON File
- **editorconfig** — EditorConfig
- **build-props** — Directory.Build.props
- **build-targets** — Directory.Build.targets

Example CLI:

```sh
node apps/cli/main.js run examples/templates/console-library-solution/ConsoleLibrarySolutionExample.slnx
# 42
```
