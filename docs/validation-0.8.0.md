# SharpForge 0.8.0 — validation and boundaries

Validation of the delivered implementation, not full C#/CLR/MSBuild/Visual Studio/Vim conformance. Baseline: uploaded 0.7.0. Machine-readable details: [validation-0.8.0.json](validation-0.8.0.json). Usage/limits: [explorer and editor guide](explorer-keymaps.md).

## Actual results

| Gate | Result | Evidence |
| --- | --- | --- |
| Node regression tests | **1,240 passed**, zero failures/skips; **88 added** | `core-results-0.8.0.tap` |
| JavaScript syntax | **135 modules**, zero errors | `syntax-check-0.8.0.txt` |
| Original IDE browser checks | 29 passed | `browser-results.json` |
| Managed DLL/IL browser checks | 12 passed | `browser-managed-results.json` |
| Workspace/docking browser checks | 23 passed | `browser-workspace-results.json` |
| Release 0.5 browser checks | 17 passed | `browser-release05-results.json` |
| Release 0.6 reverse-debug/browser checks | 27 passed | `browser-release06-results.json` |
| Native-build UI with explicit client test double | 32 passed | `browser-msbuild-results.json` |
| New explorer/menu/keymap/debug checks | **37 passed** | `browser-release08-results.json` |
| New actual-host/disk explorer checks | **11 passed** | `browser-native-explorer-results.json` |
| Browser total | **188 checks**, no page JavaScript errors | Eight reports above |
| Standalone HTML | **27 passed**, two real workers | `standalone-results.json` |
| Offline packages | **17/17** tarballs installed/imported/executed | `package-results.json` |
| Actual Microsoft MSBuild/native SDK | **Unavailable**, gate exits 1 with `dotnet ENOENT` | `msbuild-native-results.json` |

Node v22.16.0, Linux x64, Chromium 144.0.7559.96, Python Playwright. Dependencies install offline; optional CodeMirror source is local and MIT licensed. No current upstream-version claim is made.

## What the tests actually exercised

The 88 new Node tests comprise 13 breakpoint tests, 24 explorer/filesystem tests, 21 project/command tests, 21 new example-path checks and nine new cases in existing sample loops. They cover requested/bound identity, live counters, columns, invalid positions, remapping, zero-history/reverse behavior and every executable particle-sample line; a 50,000-node tree model and command enablement; XML-preserving membership and final-state items; disk create/move/copy/delete/quarantine/undo with hashes and symlink/collision/partial/conflict guards; and source examples across four compiler/IL execution routes.

The new 37-check browser suite uses production modules and actual compiler/runtime workers. It exercises tree ARIA/navigation/range selection/search, submenu keyboard focus, new/rename/copy/delete/undo, all 27 tools' menus, Visual Studio chords, Vim motions/counts/objects/registers/macros/block insertion/search/substitution/save, Emacs kill/yank/search, Sublime multi-occurrence edits, readonly debugging, project Include/Exclude, actual bound member double-click, workspace bundle export/reopen with XML/DLL/generator/breakpoint data, dirty-undo refusal, live particle-sample hit rules/removal, relocated gutter removal, source remapping, a real Vim document popout and a 5,000-record virtualized tree with fewer than 100 rendered rows. Screenshots capture production UI, not generated mockups.

The **11-check native explorer suite** starts the production Node host against an actual temporary copy of ExplorerWorkshop. It uses the production MSBuildClient. Browser module/worker loading uses the in-memory harness; a Python byte-forwarder carries API requests/replies to the actual authenticated loopback server without substituting API behavior. Checks read/write real files, preserve dirty project XML on rename, add explicit Compile membership, copy across projects and undo exact XML, quarantine/delete/restore, create empty directories, load/invoke actual DLL bytes to 42 without source replacement, and refuse external-write conflicts while preserving unsaved text. No native build job is requested and no SDK semantics are exercised.

Inherited MSBuild transport unit tests use real processes running an explicitly labeled simulator, and its 32-check browser suite uses an explicitly labeled client test double. These are not counted as native compilation/restore success. The actual SDK gate is separate and exits nonzero here because dotnet is missing.

## Reproduction

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm test
npm run check
npm run build
npm run test:packages
npm run test:browser
npm run test:browser:managed
npm run test:browser:workspace
npm run test:browser:release05
npm run test:browser:release
npm run test:browser:msbuild
npm run test:browser:explorer
npm run test:browser:native-explorer
npm run standalone
npm run test:standalone
node apps/cli/main.js run examples/projects/ExplorerWorkshop/ExplorerWorkshop.slnx
# 42
# 42
```

Install the pinned Python test requirements and Playwright Chromium for browser runs. The restricted runner uses `SHARPFORGE_IN_MEMORY=1 CHROMIUM_EXECUTABLE=/usr/bin/chromium` for inherited tests and the documented harness for new tests. The native explorer test creates/removes its own temporary filesystem and local server. Normal browser HTTP navigation has not been qualified. Run `npm run test:msbuild:native` separately with the required installed SDKs; it never substitutes a simulator.

## Archive reproducibility

`source-manifest-0.8.0.json` hashes source, tests, examples, packages and build metadata, excluding generated bundles, installed dependencies and documentation reports. The accompanying `SharpForge-0.8.0-final-archive-verification.txt` records an independent extraction of the exact delivered source ZIP, manifest validation, offline installation, tests/syntax/build, CLI execution and byte comparison of rebuilt standalone/package artifacts. Consult that log for the actual result. Build tooling does not fetch a CDN, SDK or registry dependency during this verification.

## Explicit limits

The tree's 50,000-node model and 5,000-record browser test are not claims of compiler support at those scales. The portable loader/compiler has separate limits and source-combines projects. Native hierarchy is bounded static inspection, not a full continuous design-time MSBuild/Roslyn service. No accessibility/screen-reader conformance audit or pixel-identical Visual Studio comparison was performed.

Vim/Emacs/Sublime are tested browser keymap implementations, not native editors or a complete Vimscript/plugin environment. The bundled alternative engine is CodeMirror 5.58.3, with retained license/provenance. Modal editor profiles do not apply to XML/IL textareas. Keyboard/selection coverage is substantial but not exhaustive across platforms, IMEs, extensions and hardware.

File mutations are conflict-checked, not multi-file atomic or OS-locked. Quarantined disk data can outlive in-memory undo receipts. Browser edits are in-memory until exported, and native filesystem dialogs/durable browser recovery were not qualified. Actual Node filesystem operations are tested separately from browser permission dialogs.

No new native MSBuild task/restore, Windows cancellation, desktop CLR/ILVerify, Portable PDB/process debugging, general third-party DLL/project compatibility, external IDE client or hosted CI/deployment qualification. No independent security audit. The browser compiler, VM/GC and debugger retain their documented incomplete C#/CLR/BCL semantics. Full Visual Studio and native Vim parity are not claimed.
