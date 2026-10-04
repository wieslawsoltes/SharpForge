# Local property transactions

`DesignDocument.patchProperties(patches, options)` commits an atomic group of
local property edits. `DesignDocument.geometry()` and
`DesignGeometrySession.commit()` use this seam. Arbitrary document mutations,
structural edits, resources, bindings, and ordinary `change()` calls continue to
use the complete document validator.

```js
const revision = document.revision;
document.patchProperties({
  action: {Left: 80, Top: 140, Width: '240'},
  caption: {Opacity: undefined}
}, {
  label: 'Move and resize controls',
  expectedRevision: revision,
  canEdit: (id, property) => permitsPropertyEdit(id, property)
});
```

The input is a dictionary from string node IDs to property dictionaries.
`undefined` removes a local value, exposing the existing style or default.
All other values pass through the same property schema and normalizer as a full
document validation. Numeric strings, brushes, thicknesses, enum values, and
their bounds therefore follow the existing authoring rules. Inputs are cloned;
retaining or modifying a caller-owned brush or array cannot change the committed
document or its history.

A successful change returns `true`, advances one revision, clears redo, and
creates one bounded undo entry. An empty or normalized no-op returns `false`
without changing revision, history, selection, or notifications. The operation
rejects more than 5,000 targets, more than 128 properties on a target, an invalid
label, missing controls, unknown or read-only properties, and invalid values.
It checks document disposal, read-only capability, and the expected revision
before publication. Any validation failure leaves the candidate unpublished.

The optional `canEdit(id, property)` predicate is rechecked for every requested
property at commit time. A false result produces `SFD1840`. Geometry sessions
accept the predicate in their constructor so a control locked or protected
during a drag is checked again at pointer-up. Bindings (`SFD1820`), resource
references (`SFD1821`), and template bindings (`SFD1840`) cannot be replaced or
reset by a local property patch. Their dedicated authoring commands own changes
to those value sources.

## Exact event deltas

When the validated document baseline is unchanged and only independently
validated local values change, commit, undo, and redo include this payload:

```js
{
  kind: 'Move controls',
  revision: 12,
  selection: ['action'],
  changes: {
    kind: 'properties',
    nodes: [{id: 'action', properties: ['Left', 'Top']}]
  }
}
```

Each control and changed property appears once. The delta includes removal of
an existing property and omits normalized no-ops. It guarantees that node
identity, type, order, tree structure, children, resources, bindings, and other
document namespaces have not changed. Consumers may use that guarantee with
their own document/revision checks to update only affected preview properties.
The delta object is immutable. Existing event fields and generic notifications
keep their prior shape.

`Name` changes can affect global uniqueness and `Content` can be normalized by
child cardinality, so either property takes the complete validator path.
Replacing the registered validator or normalizer also takes that path. Missing
baseline proof, external mutable data changes, replaced node objects, unusual
custom data shapes, or a baseline exceeding its memory bound do the same.
Those events omit `changes`; consumers must perform their normal complete
refresh. A failed full validation does not emit a partial delta.

## Current values and history

`document.value`, current nodes, and `snapshot()` remain mutable. In particular,
live attachment may continue to update runtime IDs through the existing API.
The incremental publication copies the document shell, nodes array, and each
changed node/property bag. Untouched current nodes and namespaces retain their
identities. These shared current values are never used as mutable history data.

Property history stores detached, immutable forward and inverse values with an
explicit presence bit. Mutating an old node alias, the current brush after a
commit, or the original input cannot rewrite either undo direction. A full
fallback stores detached document pairs. Property undo/redo preserve current
`runtimeId` and `baseProperties` for matching node IDs and types, including a
runtime ID of zero. They revalidate when mutable data differs from the trusted
baseline. Invalid restored data is rejected before either history stack or
the current document changes. Generic history also owns detached snapshots;
restoring one makes a fresh mutable current document.

Entry and byte bounds apply to both property and complete-document records.
The byte count covers the stored forward and inverse data. When a limit drops
an entry, the successful edit remains committed and cannot be undone past the
retained history.

## Cost and qualification

The mutable public document requires an **O(n) consistency scan** before using
an incremental proof. The guard checks bounded JSON data, metadata, every node's
serialized content and indexed object identity. Its cached strings are limited
to 4,000,000 UTF-16 code units per document. This is not an O(k) transaction for
`k` changed controls: the guard scans the document and publication copies the
nodes array.

After that guard, the property path normalizes, captures history for, and
reindexes only the changed nodes. It avoids the full candidate clone, repeated
whole-document normalization, complete history snapshots, and complete index
rebuild used by `change()`. Generic and uncertain cases retain those operations.

Focused qualification is prepared in
`tests/a18-model-property-patches.test.js` and
`tests/a18-model-property-delta.test.js`. It covers atomic failures, permissions,
normalization, undo/redo aliases and runtime identity, custom validators,
external changes, history limits, gesture staging, exact event keys, and
equivalence with the complete validator on a 5,000-control document.

Execution and before/after timing belong to the combined model/preview
qualification batch. No speedup or frame-budget result is claimed before that
batch is measured; the remaining O(n) guard is part of the measured path.
