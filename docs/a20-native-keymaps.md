# Native editor commands and keymaps

The Visual Studio, VS Code, Sublime, Emacs and Vim profiles use the same
`EditorModel`, UTF-16 `TextBuffer`, selection set, undo history and virtual view.
`ClassicKeymapAdapter` remains a compatibility constructor; it creates no
CodeMirror editor, textarea mirror, secondary document or secondary history.
`NativeCodeMirrorDocument` implements the document operations needed by adapters
over the native model and resolves text lazily when a caller asks for it.

## Command and binding contract

`createEditorCommandRegistry(editor, options)` exposes `list`, `get`, `has`,
`register`, `execute` and `dispose`. Editing commands consult the current view's
read-only state. Movement delegates to the virtual view so wrapping and native
browser bidi shaping determine visual positions. Headless callers use the same
UTF-16 and grapheme-aware command context without a renderer.

`KeybindingService` preindexes chord prefixes. Each binding has a stable id,
command id, key sequence, scope, priority and optional boolean context expression.
Commands execute once; a pending chord consumes an invalid second stroke and
reports it. Escape cancels a prefix. Timeouts and disposal release timers.
Composition, dead keys and AltGraph do not trigger bindings.

`eventStroke`, `normalizeStroke`, and `normalizeSequence` are public utilities for shortcut recorders and persisted bindings. They normalize modifiers and observed shifted punctuation without treating IME or AltGraph input as a shortcut.

The service exposes bindings per command, commands per sequence and exact/prefix
conflicts including Global versus Text Editor shadowing. `setBindings` validates
the whole proposed table before replacing the active table. Context predicates
use a bounded parser, with no dynamic code evaluation. `addFilter(predicate)` returns a disposable host filter and removes matching bindings from resolution without consuming unrelated chord prefixes. Filters survive binding-table replacement and are cleared on disposal.

`docs/vs-inventory.json` pins the reference, registered defaults, known unbound
commands, retained compatibility choices and platform alternatives. The reference
is Microsoft's Visual Studio General/Text Editor table, updated June 26, 2026.
The inventory intentionally records browser and historical differences instead of
claiming the browser can receive every operating-system shortcut.

## Platform alternatives

| Browser-reserved operation | Windows/Linux alternative | macOS alternative |
| --- | --- | --- |
| Close document | Ctrl+F4 | Cmd+F4 |
| New document | Ctrl+Alt+N | Cmd+Option+N |
| Navigate to file/symbol | Ctrl+, | Cmd+, |
| Next document | Ctrl+F6 | Ctrl+F6 |
| Previous document | Ctrl+Shift+F6 | Ctrl+Shift+F6 |
| Open document | Ctrl+Alt+O | Cmd+Option+O |

Menus and the command palette provide the same actions when a browser, desktop
environment, assistive technology or function-key setting intercepts an
alternative. These mappings are logical-key mappings; physical keyboard layouts
and platform interception require separate browser qualification.

## Profile behavior

| Capability | Native implementation |
| --- | --- |
| Visual Studio | Named editor actions; K, M, R and E chords; context and conflict queries |
| VS Code | Next occurrence, line delete, line movement/copy, folds, snippets, navigation and selection commands |
| Sublime | Shared multi-caret selection, next/all occurrences, split selection and column commands |
| Emacs | Mark/region, bounded kill ring, append/prepend kills, yank/yank-pop, incremental search and C-x prefixes |
| Vim document protocol | Native ranges, cursors, multiple selections, history, marks, options and view coordinates |
| Vim motions | Character/word/WORD, lines/paragraphs, counts, start/end, find/till, matching pairs and marks |
| Vim edits | Operators, text objects, insert/replace, visual character/line/block, registers, repeat and bounded macros |
| Vim search | Forward/backward regex, word search, next/previous and bounded range substitution |
| Vim workspace Ex | Save/all, close, list, next/previous buffers, horizontal/vertical split and option subset |

The `+` and `*` registers use the asynchronous clipboard provider. Permission
denial appears in status. A document change while awaiting a clipboard read
rejects the edit. Browser selection-clipboard behavior is not claimed on systems
where the asynchronous Clipboard API exposes only the ordinary clipboard.

Vim is a documented subset, not a complete Vim process. Shell execution, plugin
loading, Vimscript, external filters, terminal buffers, OS process control,
arbitrary `:set` options, native Vim regex extensions and unlimited recursive
macros are unsupported. Unknown Ex commands report their names. The behavioral
suite lists unsupported features with reasons; it tests the native model rather
than the retained third-party CodeMirror files.

Visual blocks use the same visual-column geometry as native box editing. Partial
tabs split into unselected spaces, wide graphemes remain whole, vertical motions
retain their display column through short lines, and block registers keep their
row fragments. Change, insert, append, replace, shift, yank and put operate on the
selected rows as one history operation. `I` leaves rows before the block untouched;
`A` pads them, while `$A` appends at each line end. Blocks are limited to 10,000
rows and the configured register character budget. The reference for these
semantics is [Vim's visual-block operator contract](https://vimhelp.org/visual.txt.html#blockwise-operators).

Profile switches replace only the binding table and modal dispatch. Buffers,
selections, folds, breakpoints, composition and undo history remain attached to
the editor. Leaving Vim closes its explicit undo group without replacing the
model or cancelling an IME composition. Switching documents clears pending
chords and closes a group against the old document before changing models.
Returning to an unfinished Vim insert/replace session opens a fresh explicit
history group, so intervening edits made with another profile stay separate.

## Runnable example and validation

Build the complete scope once, run `node scripts/serve.js`, and open
`/packages/editor/examples/keymaps.html` on the displayed origin. The
[example instructions](../packages/editor/examples/README.md) explain the built
module-worker graph and production CSP. The example creates one editor and
switches all five profiles over that same document. Named commands can be
invoked independently of keybindings.

The focused suites are `tests/a20-07-keybindings.test.js`,
`tests/a20-09-profiles.test.js`, `tests/editor-vim.test.js`, and
`tests/a20-vim-blocks.test.js`. They use the real
native text model; view/provider seams in Node fixtures are not browser evidence.
The editor benchmark scope records model timings separately from actual browser
keystroke-to-paint latency. No native Visual Studio, Vim executable, NVDA or
VoiceOver qualification is implied by passing JavaScript tests.

## References

- [Visual Studio keyboard shortcuts](https://learn.microsoft.com/en-us/visualstudio/ide/default-keyboard-shortcuts-in-visual-studio?view=visualstudio)
- [VS Code keyboard shortcuts](https://code.visualstudio.com/docs/reference/default-keybindings)
- [Vim command index](https://vimhelp.org/index.txt.html)
- [Vim motion reference](https://vimhelp.org/motion.txt.html)
