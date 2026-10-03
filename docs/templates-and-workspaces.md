# SharpForge 0.11 — templates, solutions, folders and ZIPs

## Create a project or solution

Choose **File → New Project / Solution** or **Ctrl+Shift+N**. The searchable catalog is filtered by language and project type. Arrow keys/type-ahead and double-click work without replacing the selected DOM row. Recently selected template IDs are saved locally when browser storage is available.

Choose a template, then configure project name, solution name, namespace, workspace-relative location, target framework, checked arithmetic, and solution layout. **New solution**, **Add to existing solution**, and **project only** produce different file plans. Same-directory layout is optional. The preview shows every new or modified file, including the complete generated `.csproj` and `.slnx` XML. Invalid identifiers, reserved names, existing files and portable-path collisions disable Create. Cancel leaves the old workspace unchanged; the dialog cannot close during an in-flight file mutation.

The browser catalog creates browser workspace records. It does not silently write an arbitrary OS path: **Location is relative to the workspace**. Export ZIP or Save Workspace to Empty Folder for a persistent copy. In an attached local-host workspace, **Solution Explorer → Add → New Project** uses actual native file operations in that workspace.

### Supported project catalog: 11 templates

| ID | Result |
|---|---|
| `console` | SDK-style executable with `Program.Main` and console output |
| `console-async` | Executable with a supported `async Task Main` and task delay |
| `class-library` | Library with no Main, a reusable static calculator and Library output |
| `empty-project` | SDK-style empty library project with no invented source file |
| `winui-blank` | Code-first web-profile Window, Page wrapper and managed counter event |
| `winui-navigation` | Window, reusable Home/Settings pages and a managed navigation shell |
| `winui-controls-library` | Reusable code-first UserControl wrapper library |
| `test-console` | Executable self-check/assertion harness, not an xUnit/MSTest project |
| `blank-solution` | SLNX with solution items and zero projects; no synthetic project |
| `console-library-solution` | Application plus library, ProjectReference and startup selection; runs to 42 |
| `winui-library-solution` | Application plus control library and a real referenced control instance |

Framework choices are net8.0, net9.0 and net10.0; netstandard2.0 is available for library kinds. They are project metadata, not SDK installation or a promise of additional browser BCL support. Browser project references combine source in dependency order. Separate assembly linking and native builds use the explicit native MSBuild backend and an installed toolchain.

No unsupported ASP.NET, WPF, MAUI, native C++, database, Docker, VSIX or Windows packaging templates are displayed as working templates. The catalog covers the project profiles this compiler/runtime can actually build or host.

## Add project items

Use **Solution Explorer → Add → New Item**. Select the template, filename, namespace and destination folder. The preview includes project membership changes and preserves unrelated project XML/comments. Default Compile items and explicit `EnableDefaultCompileItems=false` projects both receive deliberate membership. A multi-file item is one logical operation with a preflighted file plan. Native batches remain non-atomic; completed operations are reported if a write fails.

19 item templates: class, two-file partial class, static class, disposable class, simple property/view-model class; blank page, counter page, grid page, settings page, UserControl wrapper, Border-based custom-control wrapper, Window wrapper, Flyout wrapper, brush helper; text, JSON, `.editorconfig`, `Directory.Build.props`, `Directory.Build.targets`.

All code-first visual components use the existing WinUI web contract and **composition through `.View`**. For example:

```csharp
using Microsoft.UI.Xaml;
using Application;

class Host
{
    static void Main()
    {
        MainPage page = new MainPage();
        Window window = new Window();
        window.Content = page.View;
        window.Activate();
    }
}
```

The component wraps a real supported Page/UserControl/etc. It is not a fake native base class. Native WinUI inheritance, XAML, dependency properties, binding/templates, MSIX and Windows App SDK DLL compatibility are not added by the wizard. The property-model template is ordinary managed properties, not an INotifyPropertyChanged binding engine. The existing [WinUI API inventory](winui-api.md) remains authoritative.

## Open a ZIP, solution, project or folder

**File → Open ZIP** accepts standard ZIPs from SharpForge or other ZIP tools. An exported SharpForge archive restores its bounded workspace settings automatically. An ordinary archive can contain a solution, multiple solutions/projects, one project, or only files/folders. When there are multiple entry points, choose one or choose folder view. Files outside the selected project are retained, not thrown away. A ZIP with a single prefixed repository directory is valid. An ambiguous or malformed workspace manifest is rejected rather than guessed.

**Open folder** uses the File System Access API when supported; otherwise use the directory file input. Full folder traversal preserves regular files of every extension, DLL/EXE/PDB bytes, images, resource files and unknown assets. Native directory handles preserve empty folders. A browser FileList cannot report empty folders; ZIP and native directory traversal can.

The browser folder loader excludes `.git`, `.vs`, `node_modules` and the administrative `.sharpforge` tree, except for the exact `.sharpforge/workspace.json` settings manifest. Skipped directories are reported. The local Node host also excludes `.packages`, `bin` and `obj` from its workspace scan; build artifacts remain available through its build/artifact tools. Selecting a bare `.csproj` does **not** grant the browser access to adjacent source files: select its containing folder or a complete ZIP.

Folders with no C# source open as real folders; the app does not invent a `Program.cs` or `Workspace.csproj`. Binary assets can be opened as a bounded hex/image preview and explicitly saved. Invalid-text `.cs` assets remain preserved as binary bytes rather than disappearing from ZIP export.

Malformed projects and archives are validated before the current workspace is replaced. Loading does not perform native MSBuild evaluation, run project tasks, restore packages or execute source. A later explicit Build/Run/native-trust action has a separate meaning.

### Classic `.sln`

Read-only structural loading supports C# projects, solution folders, nested project membership and solution items. Unsupported project kinds and build-configuration mapping limitations are reported. **Convert to SLNX (keep original)** creates a new `.slnx` from supported structure and leaves the `.sln` unchanged. Arbitrary GlobalSection/configuration semantics are not claimed to be fully translated. Project/folder membership editing uses SLNX after conversion; native MSBuild remains the authoritative engine for native solution behavior.

## Save and round-trip

**Save Workspace as ZIP** exports the complete selected workspace records, original binary bytes, original text encodings where supported, empty directories, project/import/configuration files and a versioned `.sharpforge/workspace.json` manifest. That manifest restores entry/startup, mode, configuration/platform, open source tabs, active source, source/function breakpoint rules and built-in generator/analyzer settings. It never restores a local host URL, native build trust, arbitrary extension code or credentials.

UTF-8/UTF-16LE/UTF-16BE BOMs, CRLF and non-ASCII characters survive unchanged exports. Edited text is re-encoded in its original supported encoding. Assets and PDBs are never decoded as UTF-8 simply to save them. ZIP is standard **stored** output (uncompressed and deterministic); import accepts stored and DEFLATE, including data descriptors. Python's independent ZIP implementation reads and validates exported files in the tests.

**Save Workspace to Empty Folder** uses an explicitly selected writable directory, resolves permission before writes, refuses existing contents and performs complete path/collision preflight. The settings manifest is written too, so reopening the extracted/saved folder restores the same settings. Permission dialogs use native browser UI; this release's tests exercise the API through labeled test doubles, not a qualified native permission-dialog session. Cancellation and partial failures report the files already written. This is not a multi-file atomic transaction or an OS file lock. A different application concurrently creating files can still race a browser filesystem operation; use an exclusively chosen empty folder.

**Save sources to disk** retains the pre-existing conflict-checked, content-only behavior for attached handles. Structural changes require full-folder/ZIP export or native file operations; a successful content-only save is not presented as saving a newly created project hierarchy.

The legacy `.sharpforge.json` importer and programmatic `exportLegacyProject` command remain available for existing bundles. ZIP is the normal new workspace export.

## Solution Explorer operations

The existing keyed, virtualized tree, keyboard/range selection, search, active-document sync, scope filtering, properties, linked-file/dependency/member nodes, menus, undo and docking remain intact. This release connects the following actions to the new workspace workflows:

| Context | Implemented operations |
|---|---|
| Solution/workspace | New project/solution, Add Existing Project, save ZIP/folder, entry selection, zero-project state |
| Project | New/Existing Item, startup selection, project-only opening, XML editing, applicable Build/Rebuild/Clean and metadata actions |
| Logical solution folder | Rename/remove membership without deleting disk files, move project membership while retaining project XML children, solution items |
| Physical source/folders | Create, copy/cut/paste, move, rename, confirmed delete and conflict-checked undo; Include/Exclude and Build Action |
| External project import | Import ZIP/containing folder, select a project, copy the complete imported root under an explicit destination, preserve sibling references/assets/empty folders, append the chosen project to SLNX |
| Binary/resource item | Safe preview or dedicated DLL/EXE decompiler action; byte-preserving copy/export |
| Classic solution | Structural loading and explicit create-only conversion to SLNX |

Native file operations use the existing authenticated same-origin loopback client and real filesystem engine. Binary create uses a bounded byte payload. Destination case/Unicode identities are checked even on case-sensitive disks, including aliases of parent folders within the same batch. Existing unlisted projects are not silently re-added to a solution after removal.

This is not every Visual Studio command: native project capability systems, package browsing/installation, Test Explorer, source-control integration, design-time generators, project retargeting, arbitrary dependency rewriting and unsupported project types are not implemented by these actions.

## Limits and security

ZIP defaults: 20,000 entries, 64 MiB per file, 128 MiB expanded data, 160 MiB input/output archive, 1,024-character paths and 48 components. Inputs with traversal, absolute/reserved paths, case/Unicode aliases, links/special files, overlap, inconsistent headers/CRC, encryption, ZIP64, unsupported compression or multidisk layout are rejected before records are returned. These are not malware scanning guarantees; do not subsequently trust unknown native projects.

Studio supports at most **100 C# source files** in a browser workspace and at most **2,000,000 characters per source**. Exceeding the limit rejects replacement; no partially loaded solution is claimed. The native mutation API allows 1–256 operations per batch, 16 MiB binary creates, a 34 MiB HTTP request body and the existing text limits. Large native imports report a limit error instead of silently dropping files. Browser recovery uses best-effort storage; ZIP/folder copies are the durable workflow.

## CLI and reusable APIs

```sh
node apps/cli/main.js templates
node apps/cli/main.js templates --items --search page
node apps/cli/main.js new console-library-solution --name Demo -o ./Demo
node apps/cli/main.js run ./Demo/Demo.slnx
# 42
node apps/cli/main.js zip ./Demo -o ./Demo.zip
node apps/cli/main.js unzip ./Demo.zip -o ./Reopened
node apps/cli/main.js run ./Reopened/Demo.slnx
# 42
node apps/cli/main.js new winui-navigation --name UiDemo -o ./UiDemo.zip --zip
```

New/extract destinations are create-only or empty. The CLI does not silently overwrite an existing workspace. CLI directory traversal excludes administrative directories and preserves raw files/empty folders plus an existing validated workspace manifest. Extraction retains that manifest. Without a saved manifest, a CLI ZIP is a file backup, not a snapshot of a running Studio debugger's settings.

The new `@sharpforge/templates` package provides pure catalog/search/plan functions. `@sharpforge/archive` provides standard bounded ZIP codecs. `@sharpforge/project-system` adds `exportWorkspaceZip`, `importWorkspaceZip`, `importWorkspaceRecords`, `workspaceManifestRecord`, `writeNewDirectory`, classic-solution parsing/conversion and logical-membership edit APIs. None executes native tasks on import.

## Examples and verification

`examples/templates/` includes every project template as a real folder workspace and standard ZIP, plus a compiled item gallery containing all 19 item kinds. Regenerate them with `npm run examples:templates`.

Run `npm test`, `npm run check`, `npm run test:packages`, and `npm run test:browser:templates`. See [0.11 validation](validation-0.11.0.md) for exact observed counts, browser-harness scope, real-disk tests and qualification boundaries. Full native SDK builds and physical WebGPU execution were not qualified in this environment.
