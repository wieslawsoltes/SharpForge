# Closed generic field owners

An instance field MemberRef on `Box<int>` must not access `Box<string>`, even when
both resolve to the same FieldDef and physical slot. The field cache previously
validated the slot alone. It now checks the resolved closed declaring MethodTable
against the receiver using the existing assignability cache before admitting a
field entry. Exact instances and derived classes retain inherited field access.

The rule applies to `ldfld`, `stfld` and `ldflda`. Failed writes leave storage
unchanged, and failed address creation exposes no pointer. Metadata-only warm
entries remain keyed by receiver type. FieldDefs without an explicit closed owner
retain their existing receiver-context substitution behavior. This fix does not
extend generic method execution or source syntax.

This is a separate correctness follow-up stacked on token-cache commit
`dcf8b783`; it is not part of the token-cache PR. Focused tests use independently
authored CLI metadata, actual field handlers and snapshot restoration. No tests,
builds or platform validation have been executed for this follow-up. The sole
integration queue runs:

```sh
node scripts/limited.js node --test tests/a05-closed-field-owner.test.js tests/a05-token-cache.test.js tests/a05-statics.test.js
```
