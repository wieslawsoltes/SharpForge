# @sharpforge/editor

Embeddable browser source editor. Consumers must include or adapt the .sf-* Studio CSS rules.

Version 0.9.0 · MIT · ES modules.

This package is part of SharpForge, an executable C# subset toolchain. It is not full C#/CLR/Visual Studio conformance. The source release includes architecture, API examples, compatibility boundaries and tests.

```js
import * as api from '@sharpforge/editor';
```

Install its declared sibling packages together. npm publication is not part of this release. See the root project README and docs/embedding.md for integration.

## 0.5 editor surface

Include `@sharpforge/editor/editor.css` when embedding independently. Ctrl+F/H opens literal find/replace with case/whole-word options; Ctrl+G accepts line:column. F3/Shift+F3 navigate matches. Ctrl+Shift+\\ matches brackets; Shift+Alt+Up/Down duplicates lines. String/comment delimiters are ignored. Read-only state blocks writes/undo/replace; updates preserve per-document history. `SyntaxHighlightIndex` lexes supported input up to a configurable 2,000,000 UTF-16 characters and returns source-faithful viewport runs, with a plain viewport fallback beyond the limit or a per-window token budget. This remains a textarea/overlay editor, not a virtualized Monaco/Visual Studio text engine.

0.6 exports `NavigationHistory` for bounded immutable cross-file locations. `CodeEditor.expandSelection()` / `shrinkSelection()` use the supplied selectionRanges service. Ctrl+Alt+Right/Left invoke them. Duplicate native input events with unchanged text do not publish redundant source versions. Highlight DOM/gutters use a bounded viewport; native textarea storage remains whole-document.

## Incremental source highlighting

`SyntaxHighlightIndex.withSource(source, change?)` creates an index for the next immutable `SourceText` snapshot. A supplied
change uses `{start, length, newLength}` in UTF-16 units and must exactly describe the revision; stale or invalid hints throw
`RangeError`. Without a hint, the index derives one replacement from the common prefix and suffix. Edits in the same URI use
the syntax package's existing `relexTokens` seam, including its comment, raw-string and preprocessor restart rules. A different
URI starts a fresh scan. `CodeEditor.sourceSnapshot()` reuses `SourceText.withChange` and increments the source version only
when the text changes within that URI.

`window(options)` retains its source-faithful run and lexical-fallback contract. Normal editor paints create runs only for the
visible lines. `tokenCount` reports the complete token count without copying shifted tokens. `contextAt(offset)` provides the
existing lexical insertion context, and `brackets.get(offset)` / `has(offset)` answer matching-delimiter queries. These queries
cache up to 2,048 offsets; after one token-stream traversal of cumulative queries, a full bracket map bounds pathological
unmatched/nested input to linear token work per revision. Full `lexed.tokens`, `runs` and `pairs` snapshots remain available
on demand to consumers and preserve their array/Map shapes. A full snapshot can require work proportional to the source.

The native overlay retains identical markup when an analysis result leaves visible syntax and decorations unchanged. A
diagnostic's latest message and object still replace the old data; changes to visible ranges or severity update the overlay.
Caret, gutter, execution and selected-frame positions continue to update independently. Horizontal scrolling translates the
existing overlay, and the existing `ResizeObserver` refreshes its cached viewport height. Disposing the editor disconnects
that observer and ignores a notification already queued by the browser. No new scheduler, worker or text storage engine is
introduced. Large lexical edits can still rescan to the end, and browser latency budgets require measured qualification.

Native source changes and undo/redo publish their callbacks synchronously. Source snapshots, syntax preparation, diagnostic
objects, breakpoint values, execution locations, selection and history remain available inside those callbacks. Decoration DOM
updates requested by the callbacks share one flush at the outer change's return; callers should inspect final overlay/gutter
DOM after that return. Standalone decoration setters still synchronize their DOM before returning. Nested source changes share
the outer flush. A throwing callback propagates its error after prepared source/decorations are synchronized; disposal cancels
the pending DOM work. This batching adds no animation-frame delay and does not change public text or result objects.

## 0.8 keyboard profiles

`EDITOR_KEYMAPS` lists `visual-studio` (default), `vscode`, `vim`, `emacs` and `sublime`. Pass `keymap` to `CodeEditor` or call `setKeymap(id)`; use `onKeymapState` for a status display. The same source, readonly flag, language-service request callbacks and breakpoint decorations are preserved. Alternative modes require both `@sharpforge/editor/classic.css` and `@sharpforge/editor/editor.css`. The bundled CodeMirror 5.58.3 MIT snapshot is legacy, not latest; its notice/hashes are in `src/vendor/`. Visual Studio and VS Code are shortcut profiles, not those products' editor engines. The other modes implement browser keymaps, not native Vim/Emacs, Vimscript or plugins. Popout hosts are scoped to their actual owner document. See the source distribution's docs/explorer-keymaps.md for supported bindings and limits.

All keyboard profiles support **Escape, then Tab** to leave the editor text input, or **Escape, then Shift+Tab** to move backward. Option+Tab after Escape is also supported for Safari/macOS full-control traversal. This uses native browser focus traversal and does not insert indentation. Ordinary Tab retains the profile's editing behavior. Any intervening edit, pointer input or blur cancels the one-use escape. The hint is exposed through the editor's accessible description and Studio's keyboard settings. Composition events do not arm it. Disposing or replacing an editor profile removes the handler.
