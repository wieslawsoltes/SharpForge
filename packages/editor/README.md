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

0.6 exports `NavigationHistory` for bounded immutable cross-file locations. `CodeEditor.expandSelection()` / `shrinkSelection()` use the supplied selectionRanges service. Ctrl+Alt+Right/Left invoke them. Duplicate native input events with unchanged text do not publish redundant source versions. Highlight DOM/gutters are virtualized; native textarea storage and lexical scans are not.

## 0.8 keyboard profiles

`EDITOR_KEYMAPS` lists `visual-studio` (default), `vscode`, `vim`, `emacs` and `sublime`. Pass `keymap` to `CodeEditor` or call `setKeymap(id)`; use `onKeymapState` for a status display. The same source, readonly flag, language-service request callbacks and breakpoint decorations are preserved. Alternative modes require both `@sharpforge/editor/classic.css` and `@sharpforge/editor/editor.css`. The bundled CodeMirror 5.58.3 MIT snapshot is legacy, not latest; its notice/hashes are in `src/vendor/`. Visual Studio and VS Code are shortcut profiles, not those products' editor engines. The other modes implement browser keymaps, not native Vim/Emacs, Vimscript or plugins. Popout hosts are scoped to their actual owner document. See the source distribution's docs/explorer-keymaps.md for supported bindings and limits.

All keyboard profiles support **Escape, then Tab** to leave the editor text input, or **Escape, then Shift+Tab** to move backward. Option+Tab after Escape is also supported for Safari/macOS full-control traversal. This uses native browser focus traversal and does not insert indentation. Ordinary Tab retains the profile's editing behavior. Any intervening edit, pointer input or blur cancels the one-use escape. The hint is exposed through the editor's accessible description and Studio's keyboard settings. Composition events do not arm it. Disposing or replacing an editor profile removes the handler.
