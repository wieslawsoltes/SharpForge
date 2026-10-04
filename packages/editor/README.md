# @sharpforge/editor

A dependency-free browser source editor with an authoritative persistent text buffer, virtual lines,
multiple carets, native IME input, shared split views and composable language-service widgets.

Include `@sharpforge/editor/editor.css` and import `CodeEditor` and `EditorModel` from the package entry point.

```js
import {CodeEditor, EditorModel} from '@sharpforge/editor';

const model = new EditorModel('Console.WriteLine(42);\n', {uri: 'Program.cs'});
const editor = new CodeEditor(element, {model, onEdits: change => workspace.apply(change)});
editor.setKeymap('visual-studio');
```

See [VIEW.md](VIEW.md) for complete view contracts, option and decoration APIs, large-file resource policy,
performance boundaries, accessibility behavior and a runnable 500,000-line example.

Keyboard profiles are `visual-studio`, `vscode`, `vim`, `emacs` and `sublime`. Every profile operates on the
same model and undo stack. The bundled classic engine remains in the distribution for compatibility;
the default editor and modal profiles no longer create a second document inside it. Native command
coverage and browser-reserved shortcuts are documented in `docs/a20-native-keymaps.md`.

Press **Escape, then Tab** or **Escape, then Shift+Tab** to leave text input through native browser focus
traversal. Ordinary Tab retains editor indentation or snippet navigation. Every view owns and disposes
its listeners, asynchronous requests, layout caches, IME overlay and accessibility buffer.

Language services and workspace transactions are injected through explicit providers. Full Visual Studio,
Vimscript, native Emacs/plugin compatibility and real screen-reader/IME qualification are not implied by
browser fixtures. Read the versioned capability inventory and test/benchmark evidence for exact coverage.

MIT · ES modules · install the declared sibling packages together.
