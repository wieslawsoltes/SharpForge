# SharpForge 0.8.0 — Solution Explorer, context menus, editor modes and debugger repair

October 2, 2026 · Updated from the uploaded 0.7.0 source

## Working explorer and reusable controls

Replaced the flat source list with a project-aware Solution Explorer: solution folders, projects, dependencies/frameworks, physical folders, included/excluded and linked files, generated source and bound class/member navigation. Added search preserving ancestors, scope/Home, Sync with Active Document, Collapse All, Refresh, Show All Files, solution/folder views, active-item tracking, type-ahead and keyboard/range selection. Keyed row reuse fixes real browser double-click suppression caused by replacing the clicked element during selection. The viewport renders a bounded set of fixed-height rows; the full model remains in memory.

The new **@sharpforge/controls** is the 17th independently packaged module. It exports TreeModel, TreeView, ContextMenu, CommandRegistry and reusable CSS. Controls validate IDs and moves, separate focus from selection, provide ARIA semantics and expose policy callbacks rather than hard-coding project mutation.

New/Existing Item, New Folder, rename, copy/cut/paste, valid drag/drop, confirmed delete/undo, New/Existing Project, solution folders, Remove from Solution, project/package reference declarations, Include/Exclude, Build Action and startup/build commands are wired to workspace state. Project XML updates preserve unrelated content/comments; final item-state handling fixes phantom removed dependencies and keeps explicit non-Compile C# files visible. Cross-project copies retain destination membership even when default Compile is disabled. Unsupported project/solution renames and moving project-containing folders are declined.

## Actual disk operations and safe workspace export

The native host now exposes actual filesystem inspection/mutation/undo and binary-read APIs. Operations preflight workspace-relative paths, collisions, symlinks, resource limits and SHA-256 snapshots; source and dirty XML save before structural edits. Delete/replaced text is quarantined under `.sharpforge/changes`, with bounded in-memory undo receipts and expected-post-state conflict checks. Multi-file changes are not atomic or OS-locked; partial completions are reported and quarantined data is not automatically purged after receipt expiry.

Browser explorer actions change in-memory workspace records, not imported disk files. Export/reopen preserves source, project/import XML, DLL bytes, folders, configuration/startup, breakpoints and generator/analyzer settings. Undo refuses to overwrite newer workspace edits. Structural browser changes cannot be reported as successful content-only disk saves; use export or the native host. Native file editing does not require an SDK or build trust; native task/evaluation execution remains separately trusted OS-permission code.

## Context menus and Visual Studio-inspired layout

Added docked Properties and Environment / Keyboard, bringing the workbench to **27 independent tools**. Source editors, Solution Explorer, every tool and docking tabs have context menus, including same-origin popouts. Menus support nested flyouts, keyboard invocation/navigation, checks/radios, disabled explanations and execution-time enablement checks. Commands include contextual editor/refactoring/debug actions, row navigation, inspect/write-breakpoints, copy/export panel data and docking/window operations. Clipboard denial exposes selectable text instead of claiming success.

The default layout places explorer/properties on the right and debug/build tools below the editor, with compact spacing and an orange paused-debug status. Notifications are capped at four visible entries so repeated file operations do not cover the whole explorer. This is original Visual Studio-inspired styling, not pixel-identical parity or distributed Microsoft assets.

## Default Visual Studio mode; Vim, Emacs, Sublime and VS Code profiles

Visual Studio is the default source-editor keyboard profile. Tested chords include Ctrl+K Ctrl+C/U for comments, plus formatting/rename and navigation bindings. Environment / Keyboard, the status area and editor context menu change the persistent profile across all source editors and popouts.

Vim supports tested normal/insert/visual/block modes, counts/operators, text objects, named registers, macros, search, substitutions and undo/redo. Host-integrated `:w`, `:q`, `:wq`, `:e path`, `:bn` and `:bp` do not invoke a shell. Emacs supplies movement, kill/yank and incremental search; Sublime supplies occurrence multi-selection; VS Code is a shortcut preset. These use the same source buffers, compiler/language services, breakpoint markers and readonly debug state.

Alternative modes use an offline **CodeMirror 5.58.3** MIT snapshot with license and source hashes. This is not the latest upstream release, native Vim/Emacs, Vimscript, plugin/shell execution or a complete implementation of those editors. XML/IL textareas do not use the modal profiles. See [third-party notices](../THIRD_PARTY_NOTICES.md) and the [workflow guide](explorer-keymaps.md).

## Breakpoint fixes

Breakpoint requests now preserve the requested line separately from the executable bound point. Clicking a relocated marker removes the original request, not a duplicate. Source edits remap anchors before rebuild. Unchanged live configurations retain stable identities and hit counters; changed conditions/hit rules deliberately reset them. Pending/invalid breakpoints show reasons. Source and IL breakpoint state stay separate.

Runtime worker sessions have monotonic identities; stale output/state/inspection responses are ignored, and scheduled run errors are reported. Source reverse snapshots restore hit counters, zero-history limits no longer cause an invalid snapshot loop, and alternate editor modes preserve readonly state and gutter decorations during debugging.

The particle interpreter's baseline did not reproduce a universal runtime crash. Concrete UI binding/session issues were fixed. New tests place a breakpoint at every executable sample line and continue to termination, and browser workers exercise repeated stops, live hit-rule updates, removal, relocated markers and source-edit rebinding. This is not native/PDB or arbitrary-DLL debugging qualification.

## Examples and evidence

**32 Studio examples**: 31 executable and one intentional diagnostics case. Three new examples cover breakpoint workflows, keymaps and multi-file member navigation. The new **ExplorerWorkshop** `.slnx` includes App/Library projects, linked C#, explicit Compile/None/Content/Folder items and an ordinary managed DLL. Its C# example prints `42` twice. New source fixtures execute through IR, canonical CIL reload, direct CIL and exported/reassembled IL tests.

**1,240 Node tests** pass (+88), **135 JavaScript modules** pass syntax checks, **188 browser checks** pass across eight suites, **27 standalone checks** pass with two real workers, and all **17 package tarballs** install/execute offline. Full scope is in [validation](validation-0.8.0.md).

The new native explorer acceptance uses production UI/client, actual loopback HTTP and actual temporary disk through a byte-forwarder necessitated by the runner's browser policy. It is not a native-client/file-API test double. The inherited native-build UI suite remains explicitly simulated. No .NET SDK is installed, so the actual native build gate remains unavailable, not passing. Normal browser HTTP/file-origin navigation, native dialogs, durable storage, broad external DLLs, desktop CLR/ILVerify, native PDB debugging, hosted CI and complete VS/Vim conformance remain unqualified.

No GitHub or registry publication was requested or performed.
