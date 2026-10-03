# Solution Explorer, menus, editor profiles and breakpoint workflows

SharpForge 0.8.0 is a Visual Studio-inspired browser workbench, not a complete or pixel-identical Visual Studio implementation. This guide describes working commands and boundaries in the delivered source. Tests and measured scope are in [0.8 validation](validation-0.8.0.md).

## Open a workspace

Use **File → Open folder** or the folder input for the containing directory of a `.slnx`/`.csproj`, not just a project file without its source and imports. Browser loading uses the documented [portable evaluator](project-system.md), with at most 100 loaded Compile files and 5,000 input records by default. It does not run tasks, restore packages or link separate binaries. The tree control itself has higher data-model limits; those do not increase compiler/project limits.

For real disk operations, start the source distribution's local host:

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm run msbuild -- serve --root "/path/to/workspace" --studio dist
```

Open the printed URL and choose **Use native workspace**. File editing does not require an installed SDK or permission to run builds. Native **build/evaluation** additionally requires the installed toolchain, a host started with `--trust-projects`, and explicit UI trust. Native tasks are OS-permission code execution, not sandboxed by the explorer. See [MSBuild security and setup](msbuild.md).

The tree displays solutions, logical solution folders, projects, dependencies, target frameworks, project/package/assembly/analyzer references, physical folders, linked files, explicit item metadata, generated source and file members. Native hierarchy uses bounded static inspection, not a continuously maintained design-time MSBuild/Roslyn model. Native references can be displayed even when unavailable to the browser compiler. Source member nodes come from successful/best-effort browser compiler analysis, not arbitrary native C# language semantics.

## Tree navigation and selection

Use arrows to move or expand/collapse; Home/End and Page Up/Down navigate visible rows. Type a filename prefix for type-ahead selection. `*` expands siblings. Shift extends a range; Ctrl/Command toggles selection, and Ctrl+arrow moves focus independently of selection. Ctrl+A selects visible nodes. Mixed structural/file selections do not silently turn into destructive file operations.

Enter opens a file/member or toggles a folder. File single-click opens its source; double-click works for files and bound member spans. Member nodes are navigation targets, never file-operation targets. A repeated-click regression was fixed by retaining keyed DOM row elements across selection changes.

**Ctrl+;** focuses Search Solution Explorer. Search keeps matching ancestors, including class/member ancestors; Escape clears the search and returns focus. The toolbar provides Home, Sync with Active Document, Collapse All, Refresh, Show All Files, Solution/Folder view, Add and options. Track Active Item, expansion and selection state persist through best-effort local recovery. Scope to This changes the tree root; Home restores the complete solution.

The fixed-height tree renders only the viewport plus overscan. A 5,000-record browser test verifies search, keyboard scrolling and fewer than 100 rendered tree rows; the model has a separate 50,000-node test. The complete node model remains in JavaScript memory. This is not remote/lazy filesystem paging. A screen-reader conformance audit has not been performed.

## Working project and file commands

| Context | Commands |
| --- | --- |
| Solution/project/folder | New Item, Existing Item (supported text), New Folder, New Project, Existing Project and Solution Folder where valid |
| Project | Build/Rebuild/Clean, native Restore/Evaluate, Set as Startup Project, Edit Project File, Remove from Solution |
| Dependencies | Add/remove project or literal package references; remove supported assembly/analyzer reference declarations |
| Source/file/physical folder | Open, Copy/Cut/Paste, rename, confirmed delete and Undo Last File Operation |
| Source item | Include/Exclude and Build Action Compile/None/Content/EmbeddedResource; split/popout document |
| DLL/EXE | Open in Decompiler without replacing source; supported methods use the existing IL execution/debugger |
| Any applicable node | Properties, copy full/relative path, refresh, scope/expand/collapse and docking-window commands |

F2 renames a file. Delete requests confirmation. Ctrl+C/X/V use an internal workspace clipboard, not the desktop Explorer clipboard. Drag/drop moves files between valid physical folders/projects; Ctrl/Command-drag copies. Destination collisions, self-descendants, reserved paths and unsupported structural moves are rejected before mutation. Cross-project C# copies add explicit destination Compile membership, including projects with default Compile disabled. File rename does not implicitly rename a C# type: use the code-editor Rename refactoring separately.

SLNX membership updates preserve comments and unrelated XML. Adding to an existing solution folder inserts into it instead of creating a duplicate. Removing a project removes exact solution membership and literal build dependencies, not disk files. Project membership appends Remove/Include entries in evaluation order; Compile, generic items and supported references evaluate their final item state. Unsupported packages still require native restore; adding a declaration is not a package browser or dependency resolver.

Literal file/folder renames update known path attributes in project/solution XML. Text, comments, CDATA, property expressions, wildcard imports and arbitrary custom-task semantics are not rewritten. Moving folders containing projects is rejected because safely rewriting all relative SDK/import/task semantics is not implemented. Project/solution nodes cannot be renamed or physically deleted through file commands. Existing binary items are opened through the decompiler rather than copied through the text-only Add Existing Item picker.

Properties is an independent docked inspector, showing selection, paths, project, inclusion/build action, link/startup state and available metadata. Build Action changes use the context menu; this is not a complete editable Visual Studio property grid or native design-time properties provider.

## Disk changes, undo and recovery

The native host uses actual filesystem operations with workspace-relative path validation, no symlink traversal, SHA-256 conflict snapshots, size/depth limits, collision preflight and rechecks before changes. Source and project buffers save before structural changes. Dirty project XML is read from the buffer, not silently replaced by stale disk XML. Subsequent external writes produce a conflict and preserve unsaved editor content.

Native delete and replaced text are quarantined under `.sharpforge/changes/<id>`. Undo verifies the expected post-operation files before reversing the operation. Up to 32 in-memory undo receipts are retained; tokens do not survive host restart, and expired receipts do not automatically purge quarantined data. Multi-file operations can partially complete: completed operations and undo receipts are reported. This is neither a multi-file atomic transaction nor an OS file lock; a hostile concurrent writer is outside its guarantees. Newly created parent directories may remain empty after undo.

Browser file changes modify in-memory records and recovery data, not the original imported disk directory. Undo checks the recorded post-operation workspace and refuses to overwrite any newer workspace edits. History keeps at most 32 operations and targets 32 MiB, retaining a single oversized newest record; this is not a hard process-memory bound. Workspace records have separate 128 MiB logical content limits. Structural edits cannot be passed off as successful content-only Save to Disk; export the complete workspace or use the native host.

**File → Export workspace** writes a `.sharpforge.json` bundle containing project/import XML, source and other records, embedded assembly bytes, startup/configuration, folder data, breakpoints and generator/analyzer settings. Reopening the bundle restores those settings before compilation. Exporting a native workspace this way is intentionally unavailable: native files already live on disk, and a partial snapshot would misleadingly omit unloaded files. Browser recovery is best-effort; a downloaded bundle or normal disk backup is the durable copy.

## Context menus and docking

Right-click or press **Shift+F10 / Context Menu** in the tree, source editor, document/tool tabs and all 27 independent tools. Menus are created in the active document, including real browser popouts, with keyboard navigation, type-ahead, nested flyouts, checked/radio choices, disabled reasons, Escape/outside dismissal and focus restoration. Menu labels are text, not injected HTML. Enablement is checked again when executing a command.

Editor menus expose applicable clipboard/edit, find/replace, formatting/refactoring, definition/references, breakpoint/run-to-cursor and keyboard-profile commands. Locals/watch/object menus retain inspect/edit/write-breakpoint actions where supported. Stack/diagnostic/search rows navigate where coordinates are available. Other tools expose relevant existing commands plus copy/save panel contents and window actions. Clipboard access denial opens selectable text rather than pretending the system clipboard changed.

Window menus group/float/dock tools and documents, choose horizontal/vertical tab groups, auto-hide tools and open same-origin popouts. Document close hides a buffer; it does not erase its source from the workspace. The main window must remain open. The default layout places Solution Explorer and Properties on the right and debugger/build tools below the editor; debugging uses an orange status treatment. Compact spacing and original icon/text glyphs approximate Visual Studio conventions, not Microsoft's exact asset set or every workspace behavior.

## Keyboard profiles

**Visual Studio is the default**. Change **Tools → Environment / Keyboard**, the Settings docking tool, the editor context menu, or the status-bar profile button. The selection persists for all source documents, split views and popouts. The compiler, debugger and file buffers are the same across profiles. Raw project XML/IL textareas do not acquire these source-editor modes.

| Profile | Delivered scope |
| --- | --- |
| Visual Studio | Native SharpForge editor with Ctrl+K Ctrl+C/U comments, Ctrl+K Ctrl+D/F formatting, Ctrl+R Ctrl+R rename, Ctrl+D duplicate, Ctrl+Shift+L delete line and common navigation/debug commands |
| Visual Studio Code | Common shortcut preset on the native SharpForge editor; not VS Code or its extension host |
| Vim | Bundled CodeMirror modal keymap: normal/insert/replace/visual/visual-block modes, counts/operators/motions, text objects, marks, registers, macros, undo/redo, search and substitution |
| Emacs | Bundled keymap with movement, selection/mark, kill/yank, incremental search and host save/open/close bindings |
| Sublime Text | Bundled keymap with next-occurrence multiple selections, simultaneous edits and search |

Vim host Ex commands: `:w` saves the workspace, `:e path` opens an existing workspace file, `:bn`/`:bp` switch source documents, `:q` closes a saved document, and `:wq` saves then closes. Write-to-path/range arguments and reload/discard semantics are explicitly not implemented. `:w` in browser mode saves browser recovery, not a native file; use the native host for disk saves.

Vim is **not a full native Vim implementation**. Vimscript, plugin/config loading, terminals, shell commands and filesystem Ex commands are unavailable. Emacs and Sublime modes are likewise keymap integrations, not complete applications. All alternative modes bundle the legacy **CodeMirror 5.58.3** snapshot available offline; it is not represented as the newest upstream release. License, provenance, modifications and input hashes are in `packages/editor/src/vendor/` and `THIRD_PARTY_NOTICES.md`. No CDN fetch occurs at runtime.

The same read-only guard applies while debugging. Keymap changes and popout transitions preserve source values/caret and project identity. Undo across a mode switch uses the host's retained source history; the modal engine's internal registers/undo groups are not a cross-window persistent Vim session. Native browser shortcuts and OS keys can still intercept some combinations. Touch, IME, full accessibility and all platform keymaps are not comprehensively qualified.

## Breakpoints and debugger fixes

Use F9 or click the gutter; right-click the marker or Breakpoints row to enable/disable, configure a condition/hit rule/logpoint, or remove it. F5 initially stops at entry, then continues; F10/F11/Shift+F11 step. Ctrl+F10 runs to the current source cursor. Ctrl+Shift+F9 removes all source breakpoints. Source and direct-CIL breakpoint sets remain separate.

Requested source positions are kept distinct from verified bound sequence points. A comment/blank-line request can relocate to executable code; clicking that displayed marker removes the original requested breakpoint rather than creating a second one. Breakpoints remap through supported source edits before a rebuilt session. The table reports requested/bound locations, hit count, condition and binding status. Identical live updates retain counters; changing hit/condition/log settings deliberately resets that breakpoint's count.

Runtime session IDs reject stale requests and ignore late output/inspection results from prior launches. Asynchronous pump failures become reported paused/error state rather than abandoning the UI. Reverse snapshots restore breakpoint hit counts; zero history budgets are handled. The particle sample is tested at every executable source line, plus real-worker hit-count updates, removal, relocation, source-edit remapping and readonly modal debugging.

No reproducible particle interpreter crash was found in the baseline line-by-line test. The fixed faults are concrete UI binding, source-identity, session and hit-count/replay issues; this does not prove every debugger failure is eliminated. Browser source debugging still requires SharpForge source/profile metadata. Native Roslyn projects do not gain native process attachment or Portable PDB debugging. Ordinary DLL debugging remains the documented bounded CIL interpreter, not full CLR execution.

## Embedding the controls

```js
import {TreeModel, TreeView, ContextMenu} from '@sharpforge/controls';
// Include @sharpforge/controls/controls.css and give #tree a bounded height.
const model = new TreeModel([{id:'root', label:'Project', defaultExpanded:true,
  children:[{id:'source', kind:'source', label:'Program.cs', path:'Program.cs'}]}]);
const menu = new ContextMenu({onError: error => console.error(error)});
const tree = new TreeView(document.querySelector('#tree'), {
  model,
  onOpen: node => console.log('Open', node.path),
  onContextMenu: ({node, event, anchor, x, y}) => menu.show({
    anchor, x:x ?? event.clientX, y:y ?? event.clientY,
    items:[{label:'Open', action:() => console.log(node.path)}]
  })
});
// On permanent removal:
// tree.dispose(); menu.dispose();
```

`TreeModel` and `CommandRegistry` import without a browser DOM. `TreeView` and `ContextMenu` need a document and modern DOM APIs. The tree exposes callbacks; the host owns disk/trust/undo policy. The editor package separately exports `CodeEditor`, `EDITOR_KEYMAPS`, `editor.css` and `classic.css` for independently embedded source editors. Include both CSS entries for alternative profiles, and provide `request` handlers for language services and host commands.
