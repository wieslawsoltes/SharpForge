# SharpForge 0.4.0

A project-system and docking release built from the supplied 0.3.0 archive. Full C#/CLR/MSBuild/Visual Studio parity is not claimed.

## Workspace and disk projects

New independent `@sharpforge/project-system` package: bounded XML parser, .csproj/.slnx evaluation, SDK default/explicit Compile items, linked paths, configuration conditions, inherited project properties, project-reference closure and diagnostics. Studio adds folder/file inputs, startup/configuration selection, project properties, disk-backed explicit source saves with conflict/permission preflight, and project XML exports. The CLI can inspect/check/build/run the same supported projects. References are source-combined, not separately linked; unsupported MSBuild/NuGet/binary/analyzer features are diagnosed.

## Docking and decompiler

New independent `@sharpforge/docking` package: nested splits, tabs, edge/center drag/drop guides, keyboard actions, in-page floating move/resize, auto-hide/pin, validated layout import/export/history and host persistence. All 21 Studio tools are separate docking panels. Each source file keeps an independent editor buffer and undo history. Tools and documents can move to real same-origin browser windows and return with live state.

Assembly Explorer has its own disk DLL/EXE input, drag/drop support, loaded-assembly selector and visible-text export. It keeps the current C# project intact. Existing full-method IL, conservative reconstruction, verified subset invocation and metadata-preserving edited-IL execution remain available. Added ordinary `Hello.exe` alongside the independently hand-authored `Arithmetic.dll` example.

## Compiler, runtime, language and editor

Partial class declarations merge across files with explicit conflict diagnostics; same-named types from different namespaces are rejected instead of incorrectly merged. Contextual, bound `nameof` handles supported locals/types/members without evaluating the operand. Library targets have no executable entry point and emit real static initializers usable by the direct-CIL runtime.

Literal UTF-16-preserving cross-file search and transactional replace-all; bound source call hierarchy and LSP call-hierarchy/reference-lens endpoints; Ctrl+/ line comments, Alt+Up/Down line movement, IME shortcut handling, asynchronous hover guards, navigation-separated undo grouping, and read-only undo protection.

Managed-heap census, bounded paging with stale-cursor detection, bounded retaining-path diagnostics and host-handle telemetry. Allocation identities do not rewind with debugger snapshots, preventing stale references from aliasing objects allocated after a restore. Heap/object tools expose paging and retaining paths, including basic ordinary-CIL object inspection. The collector remains non-generational mark/sweep, not concurrent or compacting.

Built-in generators/analyzers integrate with the docked workspace; all prior generator caching, rollback, diagnostics and validated refactoring behavior is retained. Project AdditionalFiles are recorded; enabling a generator remains explicit rather than executing project-supplied code.

## Examples, packaging and tests

14 source examples total (13 executable plus one deliberate diagnostic example), six disk-project example directories/seven manifest configurations, and managed DLL/EXE/editable-IL samples. New examples are executed by regression tests rather than decorative snippets. Fifteen local ES-module packages are shipped; none are published to a registry. See `validation.md` for measured results and environment limits.

Important remaining areas: full C# syntax/semantics; generic/value-type/BCL and multi-assembly execution; arbitrary accurate C# reconstruction; Roslyn DLL extensions; full MSBuild/NuGet; Portable PDB/source debugging for arbitrary assemblies; native Visual Studio docking/accessibility/touch parity. Normal HTTP/file-origin navigation, native filesystem write dialogs and durable browser storage were not verified by the in-memory local browser harness.
