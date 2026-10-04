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

The runnable example is `packages/editor/examples/virtual-view.html`; serve the repository over HTTP.
The **Load 500,000 lines** action constructs a real Blob, decodes chunks into a persistent buffer,
and navigates the actual DOM editor. It is a functional example, not a native-platform qualification result.

## Compatibility surface

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
| `registerContribution` | Disposable `keydown`, `beforeinput`, `changed`, `cursor`, `render`, `dispose` hooks. |
| `setDecorations`, `setViewZones`, `setInlineWidgets` | Replace one owner's visual contributions without modifying document text. |
| `prepareSave`, `markSaved` | Apply EditorConfig normalization as one edit, then record a successfully saved baseline. |
| `createEditorOptionsPage(editor)` | Labelled, keyboard-operable text settings form for an embedding workbench. |

`onEdits` is the preferred workspace integration callback. Legacy `onChange(text)` remains available;
its string publication is debounced for large files because materializing a whole file is inherently proportional to file size.

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
