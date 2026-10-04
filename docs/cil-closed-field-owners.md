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

This is a separate correctness follow-up to merged token-cache PR #3474.
Focused tests use independently authored CLI metadata, actual field handlers
and snapshot restoration. Serial validation at `f038ac95` passed all 22 tests
in the command below under Node 24.21.0, one worker and a 512 MB heap cap.
Static/manifests and build validation use the required core check; platform
qualification remains staged:

```sh
node scripts/limited.js node --test tests/a05-closed-field-owner.test.js tests/a05-token-cache.test.js tests/a05-statics.test.js
```
