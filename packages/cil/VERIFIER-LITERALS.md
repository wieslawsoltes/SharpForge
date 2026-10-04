# Typed CIL String literals

`verifyCilMethodTypes(bytesOrInspector, methodToken, options)` supports `ldstr`
through the existing registered preparation and transfer policies. A literal
pushes the canonical intrinsic `String` reference. Existing reference assignment,
locals, arguments, joins, equality, branch conditions, returns and field stores
then apply without another String-specific stack representation.

A method needing literal preparation reports `SharpForge.TypedCIL.Literals/1`.
The existing `SharpForge.TypedCIL.Fields/1` profile takes precedence if a field,
normal instance or nominal signature requires metadata authority. Literal-only
methods need no core-type binding or metadata hierarchy construction. A literal
cannot prove assignability to an unrelated nominal identity: that relation remains
`unknown` with `PrimitiveNominalRelationUnavailable` until intrinsic-to-nominal
binding is implemented. Invalid primitive assignments reject with `StackUnexpected`.

## Metadata validation and bounded work

Preparation validates each distinct addressed `0x70xxxxxx` token before block
propagation, including unreachable instructions. Zero offsets, missing heaps,
out-of-range records, truncated or invalid compressed integers, zero/even payload
lengths and invalid terminal markers produce `CILT0001` / `StringOperand` at the
actual `ldstr` IL offset. The payload contains UTF-16 code units followed by its
marker; empty strings, embedded NUL, supplementary characters and unpaired
surrogates retain those exact units. The marker rules follow
[ECMA-335 II.24.2.4 and III.4.16](https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).

| Option | Default and hard ceiling | Charged work |
|---|---:|---|
| `maxStringLiterals` | 65,535 | Distinct addressed #US tokens |
| `maxStringLiteralBytes` | 1,048,576 | Compressed length bytes plus payload and marker for each distinct token |

Zero permits no literal records, so a method containing `ldstr` remains `unknown`. Repeated
loads of a token are charged once per verification invocation; separate records
with equal text are charged separately. Limits are validated lazily when a
literal policy is needed. Invalid limits and exhausted budgets return `unknown`
with `CILDF0001`; cancellation returns `unknown` with `CILDF0002`. Preparation
checks the signal before each token and at most every 1,024 payload bytes during
the marker scan. Byte-work limits are checked before that scan. Existing stack,
dataflow, signature and metadata budgets apply independently.

The preparation pass is O(instructions + charged literal bytes), with O(distinct
tokens) temporary bookkeeping. Transfer pushes an existing canonical value and
does not decode text, allocate literal objects or retain heap slices in stack
states. Verification uses the shared raw method view. A later public
`AssemblyInspector.getMethod` still produces the usual operand text and stable
public cache identity; a previously described method must still pass this
invocation's heap and budget checks.

The scope is addressed-record validation, not a global scan proving that every
heap byte belongs to a valid entry. The shared compressed-integer reader defines
accepted length encodings; no separate shortest-encoding rule is introduced.
The inspector's display reader preserves its prior permissive marker decoding,
while typed preparation validates the marker independently. Calls, constructors,
boxing/unboxing, casts, arrays, nominal indirect access and exception-handler typing
continue to require their own policies. This API does not execute methods or
grant the existing managed runtime's execution admission. Full object-model and
engine integration remains open under #2403/#2405/#52.

## Qualification

The coordinating serial run recorded results for product revision
`6aae05c05d935ae0b90de67ec9a1840fa32ac29d` on Node 24.19.0, Linux x64. The
[retained evidence summary](../../tests/fixtures/verifier-literals/qualification/summary.json)
records exact artifact hashes and the following separate results:

| Check | Recorded outcome |
|---|---|
| Pinned ILVerify 10.0.5, SDK 10.0.201 / runtime 10.0.5 | All 31 declared native expectations matched: 23 accepted, 8 rejected |
| Focused Node tests and numeric/field/indirect/document controls | 57 passed, 0 failed, 0 skipped |
| Separate public/raw inspector-method view tests | 4 passed, 0 failed, 0 skipped |
| Chromium browser API | Startup failed before any product checks; no browser pass |
| Firefox / WebKit | Not run |
| Cache-correction Node run at `6f775dca` | 38 passed, 0 failed, 0 cancelled, 0 skipped |
| Original and follow-up performance cohorts | Recorded; follow-up Diamond +5.579% exceeds the 5% budget |
| Final publication gate | Explicit PR justification/sign-off still required; no approval claimed |

Thirty native observations agree with determinate product decisions. The remaining
`NominalReturnUnknown` case stays unknown in this profile despite the recorded
native rejection; it is not counted as policy agreement. Malformed #US validation
is covered by focused structural tests, separately from that well-formed native
transfer corpus.

Chromium first failed to spawn with `EACCES`; a subsequent launch aborted when its
ProcessSingleton socket operation was denied by the host. Both raw failures are
retained and contain zero product checks. No browser qualification is claimed.

The [performance record](../../tests/fixtures/verifier-literals/qualification/performance/README.md)
retains the original twelve-sample measurements and the predefined follow-up with
120 samples, 20 warmups and 5,000 invocations per sample. The follow-up compared
`8b101c0c` with the cache correction `6f775dca`; median changes were Add -5.223%,
Diamond +5.579%, MixedJoin +1.496% and existing authority construction +1.312%.
Diamond exceeds the 5% regression budget and requires explicit PR justification
and sign-off. Neither shared-host noise nor the concrete cache-probe correction
is asserted to explain the measured difference, and no exception approval or
performance gate pass is claimed. The [fixture README](../../tests/fixtures/verifier-literals/README.md)
provides the retained logs, command provenance and remaining work.
