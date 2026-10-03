# 0.12.0

## 0.14.0 — 2026-10-03

Selected modern/preview C# language gates and project settings; field-backed properties, target-typed construction, collection expressions/capacity, conditional assignment and labeled jumps. Added Array/Random/JSON/HTTP/URI/cancellation contracts. New compute/network packages: real WASM SIMD, isolated numerical workers, explicit-origin HTTP and JS WebSocket. VM ABI/property/collection optimizations, rooted external tasks and reverse-history boundaries. Runtime & Networking tool, eight complete examples, default-deny nonpersistent grants, dual CSP/session controls, measured performance and full regression qualification. Not complete C#/BCL/CLR/thread/socket parity. See docs/release-0.14.0.md.

## 0.13.0 — source/design synchronization, BCL and timelines

- Added syntax/span-based C# ↔ designer synchronization with guarded structural edits and compile/version checks.
- Refined Design/Split/C#/Preview, property categories, contextual placement, toolbox, presets, light/dark chrome and command discovery.
- Added closed collection contracts, collection initializers/indexers/foreach, StringBuilder/string/Math helpers and regular/verbatim interpolation.
- Added shared Storyboard/DoubleAnimation clock, easing, transforms and wrapping panels; managed Completed callbacks work after Main.
- Added eight Studio/disk/ZIP examples, regression coverage and isolated package checks. See release-0.13.0 and validation for supported scope and measured gates.


Reconstructed release: connected seven-tool designer; transactional live patches; structural source Edit and Continue; 16 additional controls; dependency-property/local/template/style precedence; shared setters; per-instance control templates; five complete examples; 23 offline packages. See docs/release-0.12.0.md and docs/validation-0.12.0.md for measured validation and boundaries.

# 0.10.0 — 2026-10-02

## 0.11.0 — project templates and workspace archives

- New `@sharpforge/templates` and `@sharpforge/archive` packages (22 total); shared bounded DEFLATE codec.
- Searchable two-step project/item wizards, 11 project/solution types and 19 supported C#/code-first WinUI item types, preview and collision validation.
- Standard ZIP save/open, complete binary/encoding preservation, folder save/reopen settings, empty/asset-only workspaces, multi-entry selection.
- Project ZIP/folder import with sibling dependencies/assets, logical solution-folder editing, classic SLN structural loading and create-only SLNX conversion.
- Native binary creation and portable case/Unicode parent validation; existing files/dirty buffers are not implicitly overwritten.
- CLI templates/new/zip/unzip; all template workspaces and the item gallery are included as folders and ZIPs.
- Folder cancellation, invalid-text C# asset preservation, hidden Project Properties refresh and removed-project reinsertion regressions fixed.
- Native SDK, native filesystem permission dialogs, normal browser navigation and full VS/Windows App SDK compatibility remain outside local qualification. See release validation.


Portable PDBs, cooperative async/logical threads, managed Hot Reload and effectful evaluation, guarded instruction relocation, code-first WinUI web host, 7 docking tools, 3 packages and 10 examples. See docs/release-0.10.0.md for contracts and qualification.

# Changelog

## 0.9.0 — Exact debugger locations, stop reasons and breakpoint state

- F5 runs to breakpoints by default; F10/F11 from idle explicitly break on entry.
- Indexed statement-span binding, multiline/column locations, method-boundary fences and hidden cleanup sequence points; exact embedded-source highlighting.
- Correct caller write-stop/callsite locations, independent selected-frame marker, condition/hit/log/one-shot rules and indexed function breakpoints.
- Managed pending-fault snapshots, reverse actual-stop replay, stable condition mementos and monotonic allocation/frame identities.
- ConfigurationDone DAP barrier, loaded sources/location queries, coordinate-base handling, hit IDs, source write descriptors and stale reference guards.
- New debugger settings and Immediate docking tools; unified breakpoint management, disassembly flag preservation, repeat-command coalescing and native/keymap marker parity.
- Five runnable examples, DebuggerWorkshop project and production-worker/browser regressions. See docs/release-0.9.0.md and docs/validation-0.9.0.md.

## 0.8.0 — Explorer, context menus, editor profiles and breakpoint repair

- New independently packaged tree/menu/command controls; keyed virtualized tree rows, search/selection/keyboard/drag APIs and same-document nested menus.
- Project/dependency/folder/linked/member hierarchy, 27 docking tools, Properties and keyboard settings, Visual Studio-inspired default layout and context menus throughout.
- Browser workspace file/project commands and complete export/reopen; real authenticated native disk create/move/copy/delete/quarantine/undo APIs with hash conflict guards and dirty XML preservation.
- XML-preserving solution/project membership edits, final-state generic/reference items, Build Action and cross-project Compile handling; unsupported project-containing-folder moves explicitly declined.
- Default Visual Studio chords plus locally bundled Vim/Emacs/Sublime modes and a VS Code shortcut preset, preserving compiler/debugger integration and popup ownership. CodeMirror 5.58.3 MIT notices/provenance retained.
- Requested-versus-bound breakpoint identity, source-edit remapping, stable live hit rules, session epochs, reverse hit snapshots and safe readonly debugging; particle sample regressions.
- Three new Studio examples and ExplorerWorkshop csproj/slnx with linked/source/content/None/binary items. Native browser file acceptance uses production client plus actual HTTP and disk, not a file-API test double.
- See docs/release-0.8.0.md and docs/validation-0.8.0.md for verified scope and remaining boundaries.

## 0.7.0 — Local MSBuild workspace

- New independently packaged browser/Node MSBuild client and native backend; installed `sharpforge-msbuild` CLI and legacy CLI dispatch.
- Native SDK or owner-selected standalone MSBuild jobs, restore/pack/publish/VSTest/custom targets, graph/parallel options, JSON evaluation, preprocessing/target listing, cancellation, diagnostics, binlog and output inspection.
- Same-origin loopback host with ephemeral session tokens and dual trust controls; no shell invocation or fallback to the browser compiler.
- Raw project/solution/import editing with SHA-256 disk conflicts, multi-file partial-write reporting and UTF-8/UTF-16 BOM preservation; native Ctrl+S and dirty-buffer build guards.
- Three new docking tools, a native build layout, structural SLNX configuration/dependency inspection, project/solution creation helpers and DLL output to decompiler workflow.
- Expanded portable local imports, ImportGroup/Choose, property and numeric/version conditions, item definitions and final-property item evaluation. This path remains a bounded non-executing subset.
- Four native MSBuild example groups, explicit simulator transport tests, 32-check browser integration suite, and a separate real-SDK qualification script/CI matrix. Native SDK execution remains unqualified in this SDK-less release environment.

## 0.6.0 — 2026-10-02

- Checked int32 arithmetic/conversions and bounded primitive constant evaluation across IR, canonical MSIL and direct MSIL.
- Using statements/declarations, concrete IDisposable implementation metadata, null-safe reverse disposal and checked project defaults.
- Opt-in bounded ordinary-DLL instruction history, managed storage write breakpoints, reversible heap/GC/unwind state, DAP and Studio controls.
- Source-faithful viewport highlighting, duplicate native input suppression, semantic selection and cross-file navigation history.
- Make-constant, conditional-return, expression-bodied method and scope-preserving using refactorings.
- Positional/immutable schema generation, unreachable-statement analyzer and docked severity configuration.
- Eight new source examples, CheckedResources project/solution and StorageWrites/UsingResources managed EXEs.
- Validation details: docs/validation-0.6.0.md.

## 0.5.0 — 2026-10-02

- C# auto/computed properties, real accessor/property metadata, initializer and getter-only constructor rules.
- C# try/finally and try/catch/finally; nested unwind/rethrow and GC-root correctness in both engines.
- Direct-DLL instruction debugger and MSIL docking tool; stepping, conditions, logpoints, watches, primitive edits, exception stops and restart.
- Primitive sizeof/cpobj/unbox managed addresses.
- Structural refactorings, find/replace, goto/brackets/line duplication and reusable editor CSS.
- Actual LSP/DAP stdio binaries and strict UTF-8 byte framing.
- Auto-property schema generation, condition/task analyzers, seven new source examples and two new managed EXEs.
- Release regression/browser/package evidence in docs/validation-0.5.0.md.


## 0.4.0

Disk projects/solutions, 21 independent docking tools, document/tool browser popouts, direct decompiler disk inputs, partial classes, nameof, library targets, call hierarchy, cross-file replacement, editor/GC improvements and expanded executable examples. See [release notes](docs/release-0.4.0.md).


## 0.3.0

Ordinary managed-DLL inspector/direct-CIL execution; IL text round-trip and conservative C# reconstruction; constant switch syntax, conversions, default/??=/unchecked; reusable generator/analyzer and refactoring packages; additional LSP/editor actions; GC scratch reuse and root handles; Assembly Explorer and expanded validation. See [detailed release notes](docs/release-0.3.0.md).

## 0.2.0

Input release: genuine PE/CLI artifacts and strict source-debug profile loader. See [historical notes](docs/release-0.2.0.md).
