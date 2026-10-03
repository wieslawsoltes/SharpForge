# @sharpforge/controls

Dependency-free, independently reusable IDE controls. Import `TreeModel`, `TreeView`,
`ContextMenu` and `CommandRegistry`, plus `@sharpforge/controls/controls.css`.

TreeModel is usable without a DOM; validates stable IDs before replacing state;
retains expansion/selection through updates; supports ancestor-preserving search,
range/toggle selection, reveal, snapshots and cycle-safe moves. TreeView virtualizes
fixed-height rows, supplies ARIA position/level/selection semantics, keyboard navigation,
typeahead, keyboard context menus and drag/drop callbacks. Mutation policy belongs to
the consumer, not the tree. Use stable IDs for different appearances of a linked file.

ContextMenu renders in the anchor's owner document, restores focus, supports nested
menus, checked/radio items, disabled reasons, keyboard navigation, typeahead, escaping
and asynchronous error reporting. Commands are rechecked when invoked. All labels are
rendered as text, not HTML. Call dispose when permanently unmounting either control.
