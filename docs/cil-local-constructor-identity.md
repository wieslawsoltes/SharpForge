# Local constructor identity in managed CIL

The canonical consumer replay at `43fa19c425700e1c4703190f100239c06dd97a75`
compiled both of these existing inputs successfully, then faulted during CIL execution:

| Existing input | Observed execution failure | Preserved expected output |
| --- | --- | --- |
| Source `Shape` and `Button` in `compiler-canonical-managed-replay.test.js` | `Field declaring type does not match the receiver` | `3mine\n` |
| Pinned `member-initializers/nested-object-initializer-reads-the-member-each-time` | `Call receiver has no matching declaring instance` | `2\n1 2 3 0\n0\n` |

The complete 74,196-byte original replay is retained losslessly in
[the evidence directory](evidence/project5-local-constructor-identity/), together
with its unmodified launcher manifest and the two complete failure observations.
Its uncompressed SHA-256 is
`7b57bbfc9e2bc9528980283cd5d93a35b83074fa3d2e862fde4fc277be116b9b`.
The nested initializer's source and existing Roslyn pin remain unchanged.

## Cause and correction

The compiler's member-token emitter selects the local constructor's `MethodDef`.
`resolveExecutionMethod` carries the resolved local definition into runtime call
selection. The CIL verifier already gives that local body priority, and the method
table registry preserves explicitly defined local names.

Runtime call selection nevertheless looked up a framework intrinsic for every
descriptor. Framework alias lookup maps the short names `Button` and `Line` to
their WinUI types, whose registered parameterless constructor signatures match.
The `newobj` framework-contract branch preceded local allocation, so it created
the framework object and skipped the source constructor. The subsequent local
field or getter access correctly rejected that object's unrelated method table.

The existing call-selection seam now skips intrinsic lookup when a concrete
local method target has been resolved. The ordinary local allocation and
constructor-body path therefore runs. This aligns runtime construction with the
verifier's existing selection order. Unresolved external constructors still use
their registered contracts, and the separate managed delegate path retains its
existing behavior. Field ownership and method receiver checks keep their exact
rejection conditions.

There is one production-line change, in
`packages/runtime/src/execution/calls.js`. There is no compiler emission change,
profile conversion, or new admission exception.

## Focused controls and remaining qualification

`tests/a05-local-constructor-identity.test.js` was committed before the production
correction. Its eight controls cover observable field initializers and constructor
bodies for both source names; simultaneous local and genuine framework `Button`
construction; an independent framework-only constructor and inherited property;
independently authored local `MethodDef` and `MemberRef` constructor operands;
both receiver guards against a framework namesake; and a source delegate named
`Button`. All compiled controls use ordinary PE/CLI without `#SF` metadata.

The original two replay files remain unchanged. Scheduled verification should run
the new focused file, the existing intrinsic/field-owner controls, and those two
original cases. The source checkpoint has not executed those tests yet. The
original failing observations establish the pre-fix behavior, not a candidate
pass. Timing of the per-call selection change also remains pending; no speedup or
regression-budget claim is made. Project #5's wider canonical CIL acceptance work
remains open.
