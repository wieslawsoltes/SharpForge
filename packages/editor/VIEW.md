# Virtual editor contracts

The model stores authoritative UTF-16 text in the persistent `TextBuffer` supplied by `@sharpforge/text`.
`CodeEditor` composes that model, a virtual line view, a bounded native input bridge, named commands and language contributions.
No editor mode owns a second whole-document textarea or CodeMirror document.

## Embedding

```js
import {CodeEditor, EditorModel} from '@sharpforge/editor';

const model = new EditorModel('class Program {}\n', {uri: 'Program.cs'});
const editor = new CodeEditor(element, {
  model,
  onEdits(change) {
    // Forward precise changes to the workspace/language worker.
    publish(change.changes, change.version);
  },
  options: {wordWrap: false, tabSize: 4, renderWhitespace: false}
});

editor.setSelections([{anchor: 6, active: 13}]);
editor.insertText('Example');
editor.toggleSplit();
editor.setDecorations('review', [{start: 0, end: 5, className: 'reviewed'}]);
```

Include `@sharpforge/editor/editor.css`. The package stylesheet imports the individual virtual view,
token, widget, keymap and accessibility stylesheets. Studio's build contribution concatenates those
same files directly, so no runtime CSS import is required by the bundled application.

The runnable example is `/packages/editor/examples/virtual-view.html` in the built distribution.
See [examples/README.md](examples/README.md) for the production-server and module-worker setup.
The **Load 500,000 lines** action constructs a real Blob, decodes chunks into a persistent buffer,
and navigates the actual DOM editor. It is a functional example, not a native-platform qualification result.

## Compatibility surface

### Shared document permissions

`EditorModel.readOnly` / `setReadOnly(boolean)` is shared document state. `onDidChangeReadOnly(listener)`
returns an unsubscribe function. Every attached `CodeEditor`, including an internal split, updates its
native input, ARIA state and keymap state immediately. Locking a document cancels active composition.
Model edits and prepared commits reject with code `SFEDITOR_READ_ONLY`; undo/redo return `false` while
locked. Toggling the lock leaves text, version and undo history intact. Workspace fault rollback through
`restoreCheckpoint` remains available while locked and retains the current lock.

### Workspace text configuration

Studio can call `configureDocumentEditor(editor, {records, languageOptions})` from
`apps/studio/workbench/editor-configuration.js`. `records` contains actual workspace files, including
`.editorconfig`; `languageOptions` is the host-selected flat per-language overlay. Only ancestor configs
are read, root-to-leaf, through the existing `applyEditorConfig` API. The helper accepts at most 20,000
records, 64 ancestor files, 1,000,000 characters in one config and 2,000,000 total configuration characters.
Shared models supply bounded config reads without flattening unrelated source records.

Reconfiguration clears earlier document indentation/save settings before applying the new path's
sections. An opened document's dominant EOL controls Enter by default, and ordinary saves retain every
existing line ending, including mixed endings. An explicit `endOfLine` option or EditorConfig
`end_of_line` setting normalizes endings as one undoable save transaction. Trimming and final-newline
options remain independent of EOL conversion.

Offscreen wrap invalidation queues affected logical ranges. Each measurement turn handles at most
128 lines / 32 KiB of rendered fragments; changing a line never requires visiting it to repair row counts.
Folding providers debounce every edit, since removing one character can change syntax, indentation or
region ownership. The provider cancels superseded requests and its pending timer on disposal.

### Editing and view API

| API | Contract |
| --- | --- |
| `setModel(uri, textOrEditorModel)` | Switch documents, preserve view selection/scroll/folds and shared model history. |
| `value`, `input.value` | Explicit full-text compatibility materialization. Native textarea storage remains bounded to 2,048 characters. |
| `input.selectionStart`, `selectionEnd`, `setSelectionRange` | Global document UTF-16 offsets through the explicit element adapter. |
| `getSelections`, `setSelections` | Ordered directional multi-selections with `anchor`/`active` and `head` compatibility. |
| `applyEdits(edits, options)` | Atomically validates original-coordinate `{start,end,text}` edits; accepts `deleteCount` aliases. |
| `sourceSnapshot()` | Immutable, structurally shared snapshot. `text` and `lineStarts` materialize only when requested. |
| `view.coordsAt(offset)` | `{left,top,height,local:true}` in CSS pixels relative to the editor element. |
| `view.positionAt(clientX,clientY)` | Global UTF-16 offset from client coordinates. |
| `view.scrollTo`, `view.render` | Logical scroll coordinates; immediate render for explicit integration/measurement. |
| `registerContribution` | Disposable input, `beforeEdit`/`afterEdit`, change, cursor, render and disposal hooks. |
| `setDecorations`, `setViewZones`, `setInlineWidgets` | Replace one owner's visual contributions without modifying document text. |
| `prepareSave`, `markSaved` | Apply EditorConfig normalization as one edit, then record a successfully saved baseline. |
| `createEditorOptionsPage(editor)` | Labelled, keyboard-operable text settings form for an embedding workbench. |
| `refreshPreview()` | Refresh caches after a reversible model checkpoint preview without publishing or recording edits. |

`onEdits` is the preferred workspace integration callback. Legacy `onChange(text)` remains available;
its string publication is debounced for large files because materializing a whole file is inherently proportional to file size.
Shared split views publish each change once through the original view. Clipboard events preserve typed multicaret/box/line
metadata when available and retain a plain-text fallback. `setReadOnly` also sets the shared model's read-only state so
workspace edits observe the same permission. `setOptions` is the keymap-compatible alias for `updateOptions`.

## View behavior and resource policy

Rows are recycled by logical line and continuation index, with at most 160 visible/overscan row elements.
Selections, margins, fold hints, navigation and hit testing use the same Fenwick visual-row index.
The index initializes in O(lines) compact numeric storage; row updates and inverse mapping are O(log lines).
The surface scales beyond 16 million physical CSS pixels while callers keep logical scroll coordinates.
Rendering never reads all source lines or constructs a document-wide DOM tree.

Font measurements cache grapheme offsets, visual columns and pixel positions per line/font revision.
Grapheme and visual-column functions come from the shared text package. Native DOM `Range` rectangles and
the browser's bidi layout provide shaped visual selection/movement for Arabic/Hebrew and mixed-direction text.
Input composition stays outside the buffer until one final commit. Editing commands are suppressed during IME composition.

`SyntaxHighlightIndex` uses the compiler's existing `relexTokens` convergence algorithm and persistent `TokenList`.
Viewport runs read only the tokens covering the requested range. Accessing the public `runs` or `pairs`
properties explicitly requests a document-wide compatibility index; ordinary row rendering does not use them.
Bracket colour indexing and fallback outlining are cancellable/chunked background tasks.

At the configurable 20 MB threshold, semantic work, wrap and map preview are suspended while the same buffer
remains editable. The native input stays bounded. Long lines render a bounded horizontal fragment rather
than creating unbounded token spans. For giant single lines outside that fragment, horizontal extent is
estimated from measured monospace width; arbitrary proportional-font shaping across an unseen giant prefix
is not claimed. `loadFile(Blob,{signal,onProgress})` stages decoded chunks and switches the document only
after successful completion. A cancelled or malformed decode preserves the original document.

## Accessibility and qualification

The native input retains textbox semantics, a bounded assistive buffer around the caret, and line/column
and selection announcements. Diagnostics and breakpoints have named keyboard navigation. Fold controls,
scrollbars, options, splitters and widgets are keyboard reachable. Forced-colors and reduced-motion styles
cover selections, carets, squiggles and margins.

The code uses standard browser APIs without a platform-specific native host. Automated DOM/IME fixtures
must be reported separately from real Japanese/Chinese/Korean IME sessions and NVDA/JAWS/VoiceOver sessions.
This implementation does not claim native assistive-technology certification or a measured 200 MB latency
target until the actual platform benchmark and interactive accessibility checks have run.
