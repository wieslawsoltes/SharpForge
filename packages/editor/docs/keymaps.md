# Keyboard profiles

`CodeEditor#setKeymap(id)` selects `visual-studio`, `vscode`, `sublime`, `emacs`,
`vim` or `resharper` (ReSharper-like IntelliJ). Changing profiles preserves the
model, selections and undo history.
`EDITOR_KEYMAPS` supplies the display labels. `ClassicKeymapAdapter` is retained as
a compatibility constructor and delegates to the native model-backed adapter.

`createEditorCommandRegistry(editor, options)` exposes command registration,
lookup and execution without requiring a keyboard event. `KeybindingService`
resolves key sequences, chord prefixes, contextual bindings and scope conflicts.
It validates a replacement binding table before making it active. Composition,
dead keys and AltGraph input do not trigger command bindings.

`KeybindingService` schedules chord timeouts through the current global timer
methods with their owning global receiver. An injected `clock` remains the
owner of its `setTimeout` and `clearTimeout` method calls. Completing, cancelling,
replacing or disposing a pending chord clears its scheduled timer.

The public `eventStroke`, `normalizeStroke` and `normalizeSequence` utilities are
shared by shortcut recorders and persisted bindings. `getProfileBindings` returns
the profile's bindings; `platformBindingInventory` records platform alternatives.
Read-only state remains authoritative in the model and editing command context.

The [standalone example](../examples/README.md) switches all six profiles on one
document. Full command coverage, the pinned reference inventory, compatibility
choices and reference links are maintained in the repository's
[`docs/a20-native-keymaps.md`](https://github.com/wieslawsoltes/SharpForge/blob/main/docs/a20-native-keymaps.md)
and `docs/vs-inventory.json`.

Native Visual Studio/Vim/Emacs executable equivalence, browser-reserved shortcuts,
and OS accessibility or IME behavior require their respective qualification.
Package model tests do not establish native application parity.
