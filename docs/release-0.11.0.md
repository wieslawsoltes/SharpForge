# SharpForge 0.11.0

Built from the supplied 0.10.0 source. This release focuses on creating and preserving usable solutions/projects, reusable code-first WinUI items, and the Solution Explorer workflows connecting them.

## Implemented

**Project and solution wizard.** Ctrl+Shift+N opens a keyboard-accessible two-step template catalog, with search, language/type filters, recent IDs, configurable names/namespace/location/framework, checked arithmetic, new/existing/no-solution options, same-directory layout and a complete file/XML preview. Eleven project templates cover console, async console, library, empty project, code-first WinUI app/navigation/control library, console self-tests, blank solution and two application-plus-library solutions.

**Item wizard.** Nineteen templates cover C# classes/partial/static/disposable/property-model types; WinUI pages, Grid/settings/counter pages, UserControl/custom-control/window/flyout/brush wrappers; and text/JSON/build/editor configuration files. Project membership preserves original XML/comments. WinUI uses the supported web profile and composition through `.View`; no unsupported native base-class or XAML behavior is implied.

**Workspace ZIPs and folders.** Standard deterministic ZIP export and stored/DEFLATE import preserve all selected workspace records, assets and DLL/PDB bytes, text BOM/line endings, empty folders and bounded settings. Folder extraction/save restores the same manifest. Multiple entry points require an explicit selection. Empty solutions show zero projects; asset-only folders remain folders. Loading never runs native tasks or restores native build trust.

**Solution Explorer.** Added workspace ZIP/folder actions, external-project ZIP/folder import preserving sibling dependencies, safe asset preview, more solution-folder/member edits, explicit entry opening and classic SLN structural loading/conversion. Existing source/property/member trees, context menus, copying/moving/deleting/undo, Compile membership, references, startup, build and docking remain connected. Native Add actions perform actual disk writes through the existing local host; browsers use explicit export/save rather than pretending virtual paths are OS directories.

**Reusable packages and CLI.** New `@sharpforge/archive` and `@sharpforge/templates` bring the total to 22. The CLI adds templates/new/zip/unzip with create-only/empty-directory destinations. All eleven template workspaces plus a nineteen-item gallery ship as both folders and standard ZIPs.

## Corrections discovered during validation

Previously filtered assets and invalid-text `.cs` files now survive load/export. ZIP/native/folder preflight rejects case/Unicode aliases of parent folders, not only leaf duplicates. Directory-save cancellation retains an AbortError and reports partial writes. The ZIP reader accepts the optional-descriptor signature's ambiguous CRC form correctly. Legacy file-source disk saves preserve supported UTF-16 encoding and recheck external edits after permission prompts. Project Properties refresh when an entry changes; removed native project membership is not reinserted by a fallback scan. Dirty native source/XML cancellation preserves the active workspace. Corrupt recent-template storage cannot break the wizard. Image previews use an explicit image-only Blob CSP allowance, not broader script permissions.

A pre-existing DAP integration test assumed one wall-clock scheduling slice completed Main. It now pumps to the actual managed boundary with a finite limit; assertions on the scene/event result remain unchanged.

## Observed verification

1,809 Node tests, 177 JavaScript syntax modules, 276 browser checks across eleven suites, 43 standalone checks with two real workers, and 22 isolated offline package installations. The browser template suite contains 23 checks, and the actual local-host native explorer suite has 13. See the validation report for final archive checks and exact reproduction.

## Boundaries

This is not the entire Visual Studio template catalog or project system. Templates are limited to working SharpForge profiles. The self-test console is not an external test SDK. WinUI is not native Windows App SDK/XAML/MSIX. Browser builds remain source-combined and bounded to 100 C# files; native builds need installed SDKs. ZIP64/encrypted/multidisk/unsupported-compression archives and unsafe paths are rejected explicitly. Native/bulk folder operations are not multi-file atomic transactions or OS locks.

Normal HTTP/file-origin browser navigation was blocked by the runner; production modules and real workers were exercised through the documented in-memory harness. Real loopback HTTP/temp-disk operations were tested separately. Native browser file permission dialogs, durable storage, Microsoft SDK builds, physical WebGPU and external native IDE/runtime interoperability were not qualified. The SDK gate explicitly reports unavailable (`dotnet` ENOENT), not a pass.
