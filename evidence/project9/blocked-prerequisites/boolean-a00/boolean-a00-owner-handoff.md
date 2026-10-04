# Unapplied Boolean readonly-string contract handoff

This is a concrete proposal for the current A00 owners. It is **not applied**,
tested, qualified, committed, or published. All proposed edits exist only as
ignored patch artifacts under `artifacts/project9-resume`. The Boolean feature's
portable-source qualification remains open until the owners land and qualify
the required changes. This handoff does not close #783.

The accompanying manifest records the exact authoring commit, each current file's
Git blob and SHA-256, each proposed file SHA-256, and the combined/split patch
digests. Compare the per-file bases before applying; root may merge unrelated
main changes while this read-only handoff is reviewed.

## Ownership and proposed split

| Owner | Coordination issue | Unapplied patch | Proposed tracked scope |
| --- | --- | --- | --- |
| Public bytecode facade owner, to be resolved | Separate protected-index claim and lock; not covered by #1062/#1066 | `boolean-a00-public-facade-owner.patch` | One public entry-point export of the existing central validator |
| `codex-p4-planning` | #1101, `agent/SF-A00-T10.4` | `boolean-a00-gate-owner.patch` | Contract-change proof and its gate tests |
| `codex-p4-abi` | #1062 | `boolean-a00-schema-owner.patch` | Format-2 image schema, structural tests, schema README |
| `codex-p4-abi` | #1066 | `boolean-a00-typed-body-owner.patch` | Source typed-body adapter, typed-IR tests, method-body documentation |

`boolean-a00-owner-handoff.patch` combines the nine proposed files. The split
gate tests intentionally read the schema owner's proposed carrier, so final
positive qualification requires the paired schema change. Owners may coordinate
a single qualification branch or land the independently reviewed proof first
with a fixture retained by that owner; this artifact does not change their claim
or publication procedure. The reported gate lease is through 23:59 UTC at the
original ownership handoff; the live owner must recheck current lease state.

The application order is public-facade prerequisite, gate proof, schema, and typed
body, followed by combined qualification. Each split touches disjoint files and
is separately applicable against its recorded bases. Tests intentionally exercise
the integrated feature, so independent applicability does not imply independent
test readiness. The public export is a separate proposal requiring the live
protected-index owner/lock and normal structure/import checks. No lock has been
acquired, no exception is requested or assumed, and the typed-body reservation is
not treated as authorization for that protected index. Its central validator leaf
and Boolean descriptors are supplied by the current feature branch; a standalone
owner branch must first coordinate that dependency.

## Structural schema change

Only `constants.items` gains `object` after the existing flat `number`, `boolean`,
`string`, and `null` type alternatives. The object case has exactly one required
`readonlyField` key; that value is a closed object with required `owner` and `name`
strings with a nonempty constraint. No structural upper-length or NUL pattern
constraint is added. No union traversal,
reference, definition indirection, discriminator constant, or new schema keyword
is introduced. Existing primitive validation traverses exactly the same nodes.
The proposed tests pin the old/new primitive budget at both the exact accepting
threshold and one node below it.

Structural validation is performed on parsed serialized JSON before
`deserializeImage`; then the existing semantic verifier checks exact registered
identity, string/static/readonly policy, NUL exclusion, and UTF-16 code-unit bounds
of 1024/512 for owner/name. The proposed tests first accept NUL-bearing and oversized
strings structurally, then require rejection by the shared semantic verifier,
including astral strings that exceed the UTF-16 bound. Unknown names may be structurally
valid but remain semantically invalid. The schema deliberately keeps static
default values primitive-only, matching the current constructor/emitter rejection
of eager field markers. Existing tagged numeric carrier gaps are not changed.

The existing JS and Rust readers use different string-length units. Restricting
the new structural constraint to nonempty strings avoids adding an upper-bound
disagreement for astral names or redundant pattern grammar work. UTF-16 length and
NUL policy remain entirely in the shared semantic validator. Rust structural-reader
qualification is still pending; no unrelated reader length-policy change is
included or claimed.

## Narrow additive proof

The new carrier and uniform-items proofs are disabled if either complete input
schema contains any reference or reference-scope keyword. The guard scans the
whole schema once and passes the result through recursive comparisons; inspecting
only the changed item is insufficient. An actual before/after regression records
a document accepted by an unchanged `oneOf` containing a reference to the old
primitive item predicate but rejected after that predicate is widened. The gate
must report that change as breaking. Dynamic/recursive references and anchor/ID
contexts are conservatively rejected too. Existing proof rules remain unchanged;
this guard bounds only the two new rules, without claiming an audit of all prior
schema compatibility decisions.

The new proof applies only when the old predicate is a nonempty, duplicate-free,
primitive-only type array plus optional annotations. The new type array must be
the identical ordered old array followed by exactly `object`. It permits only
closed inline records whose named properties are all required and whose leaves
are strings with well-formed optional length/pattern constraints. Nested records
are bounded to eight levels. References, scope changes, unions, arbitrary object
admission, unknown keywords, altered primitive constraints, open records, invalid
required lists, invalid patterns, and unrelated type alternatives fail closed.

Uniform `items` recursion is added only where both surrounding schemas explicitly
have `type: 'array'` and both item predicates are schema objects. Existing array
constraints still go through the unchanged conservative comparison. Tuple,
boolean-item, changed-bound, new-uniqueness, and implicit-array transformations do
not gain a proof. Existing string-pattern union handling and prior additive rules
remain in place. No generic schema implication solver or contract-gate exception
is proposed.

This argument proves old accepted primitive values remain accepted. It does not
declare every mathematically additive schema edit supported by the gate; the
proof intentionally recognizes only this bounded class.

## Typed source adapter change

A source `CONST` whose value carries `readonlyField` first calls the already
implemented `verifyReadonlyFieldConstant` through the proposed public bytecode
entry-point export. The adapter does not import a private package leaf or clone
its validation policy. Malformed shape, inherited or
function tags, accessors, aliases, unknown fields, numeric fields, and numeric
hints fail before reading marker properties. A valid load uses the existing
`load-static` operation with zero inputs and one `ref:System.String` output.
The field descriptor retains canonical owner, name, and `System.String` storage.
Its source-scoped ID is `field:` followed by the JSON owner/name pair, avoiding
delimiter ambiguity; this is not a new numeric ABI identifier. Direct CIL keeps
its existing metadata-token descriptor ID and `ldsfld` lowering.

Tests compare the source/CIL field semantics, preserve stack prefixes, validate
the existing typed-body schema and reader gate, and cover malformed carriers with
noninvoked getters. Ordinary primitive lowering and the operation vocabulary are
unchanged. This exports typed semantic input; it does not qualify a new backend
or claim runtime execution of that exported neutral IR.

## Qualification still required from the owners/root

No project code, tests, native capture, build, or benchmark was executed to author
these diffs. `git apply --check` is only an applicability check and does not apply
or qualify the patch. Independent static review must be recorded separately.

After owners apply their reviewed changes in an authorized branch, the focused
qualification includes:

```sh
node scripts/limited.js node --test planning/contracts/tests/gates.test.js tests/a00-05-metadata.test.js tests/a00-05-typed-ir.test.js
```

The normal contract-change gate must report this exact paired image-schema change
as additive with unchanged component/format/opcode versions. Run the owned
schema/golden-fixture checks, impacted-consumer selection, static/structure checks,
and any required Rust structural-reader qualification against the same proposed
closed carrier. The JS node-budget tests do not establish Rust parity. Re-run the
Boolean source/reload/direct-CIL field suite after integration. Root remains the
serial execution owner and will select the exact full commands and evidence
paths. No qualification command above has been run by the authoring lane.

Recommended version policy: no new opcode, numeric contract ID, image format
version, or typed-body vocabulary version. This recommendation depends on the
owners accepting and qualifying the bounded additive proof; it is not a bypass
of their compatibility gate.
