# A05 review of A00 runtime inventories and metadata goldens

This review responds to the core CI failures on PR merge `4802e7382be0784164fdc8d1b71a6bbfc92fe192` (tree `90a9350e1a692628dd9dfbc0f2c4e382588907c4`), whose parents include main `75f0caad` and A05 public head `312cd9242a492ce6f03e7e034a51cc17669a7edf`. The merge checkout is distinct from the branch checkout. This is a review of specific observed drift, not authorization to replace unrelated baselines.

## Current JS value inventory

`value-abi/current-js-inventory.json` describes implementation carriers and fingerprints reviewed source. Its old prose no longer describes A05: source value structs and Nullable payloads may include owned managed references; explicit layouts retain a reference sidecar; primitive arrays have typed backing and a byte-derived capacity; managed byrefs and scoped memory are owner-bound; typed frame planes avoid some scalar carriers; and portable snapshots have a separate versioned graph codec.

The corrected inventory includes the implementation leaves responsible for these representations, so extracting behavior out of the original VM/heap files no longer hides it from source fingerprinting. The descriptive data is separated into `scripts/planning/value-inventory-description.js`; reproducibility still compares the entire generated inventory, including all source hashes. The ten existing result-kind keys and the inventory document's field structure remain unchanged.

This update does **not** change Portable Value ABI 1. `value-abi.md`, `versions.json`, `scripts/planning/abi/value-codec.js`, its envelope validation, tags, 64-bit interchange profile and one-million-element codec bound remain authoritative and unchanged. The current VM's array bound is a different implementation limit. VM snapshot serialization is also a different format: describing its supported identities does not permit raw JS carriers in the Portable Value ABI 1 envelope. No schema-version bump is required for corrected descriptive text and reviewed source hashes.

## Root-provider inventory

The new literal sites are `execution/frame-roots.js:roots:1..3` and `execution/sync-primitives.js:roots:1`. The former gathers platform/synchronization roots and preserves the public iterable fallback; the latter retains monitor objects, waiting tasks and managed owners of Boolean lockTaken addresses. Source/CIL VM and scheduler wrappers now delegate to the shared visitor inventory. Their obsolete repeated call sites are removed from the extracted manifest.

The semantic review in [gc-roots.md](gc-roots.md) covers nested value/reference roots, callback scopes, retired frames, async and array continuations, terminal-context exclusion and fault diagnostics. The lexical guard is unchanged and continues rejecting every new undocumented `roots(` site. Visitor helpers still require semantic review because the literal-site scan cannot discover them automatically. This documentation change neither adds roots nor changes collection behavior.

## Native-callback metadata golden

The failed CI log retains both complete JSON values. Comparing them shows exactly five changed `operands[0].id` fields across seven method bodies:

| CIL method token | Normalized instruction offset | Referenced member | Old MemberRef | New MemberRef |
| --- | ---: | --- | --- | --- |
| `0x06000002` | 3 | `System.Exception::.ctor(string)` | `0x0a000002` | `0x0a000001` |
| `0x06000003` | 25 | `System.GC::Collect()` | `0x0a000003` | `0x0a000002` |
| `0x06000003` | 45 | `System.Console::WriteLine(string)` | `0x0a000004` | `0x0a000003` |
| `0x06000004` | 1 | `System.Object::.ctor()` | `0x0a000001` | `0x0a000004` |
| `0x06000005` | 1 | `System.Object::.ctor()` | `0x0a000001` | `0x0a000004` |

Source proof: A05 commit `5b9b759dc` extracted source value constructor scaffolding into `packages/cil/src/emit/source-values.js`. The old `helperBody` eagerly called `external('object','.ctor',...)` even for the assertion helper. The new `initializeReceiver` requests that member only for the allocation and constructor helpers; value constructors use `initobj`. `emitter.js` allocates MemberRefs in first-use order through `metadata.member`. The assertion helper therefore allocates the exception constructor first, while the Object constructor is allocated when its actual helper body is emitted.

The CI comparison leaves source and CIL opcodes, member owners/names/signatures, method IDs, branches, exception regions, typed stack effects, return conventions and all other fields byte-identical. MemberRef IDs remain artifact-local metadata identities; their declared schema and resolution meaning are unchanged. No decoder/schema loosening or runtime behavior adjustment is justified by these five differences.

## Regeneration on the reconciled source

Generation used local merge `0e1ff8e8bde886b9ed583395adb466718b036511`, whose tree `a6bc77992bdb5f71a9209daf88cbd4461507ede2` exactly matches root integration `59da6ca7710e867702189cd67e3eedd527fb8c13`. All eleven schema outputs were generated into a staging directory before review; only four differed and were copied into the tracked fixtures:

- `native-callback.bodies.json`: the five MemberRef IDs listed above.
- `nested-finally.bodies.json`: seven MemberRef IDs from the same first-use allocation change; no other body fields changed.
- `parked-frame.bodies.json`: ten MemberRef IDs from the same first-use allocation change; no other body fields changed.
- `nested-finally.image.json`: the catch type and exception local type now use canonical `System.Exception`, and the catch records `handlerEnd: 16`.

The additional body changes preserve each referenced member's full owner/name/signature and every other instruction field. Their complete token mapping is:

| Golden | Referenced member | Old MemberRef | New MemberRef | Call sites |
| --- | --- | --- | --- | ---: |
| nested-finally | `System.Exception::.ctor(string)` | `0x0a000002` | `0x0a000001` | 2 |
| nested-finally | `System.Console::WriteLine(string)` | `0x0a000003` | `0x0a000002` | 3 |
| nested-finally | `System.Object::.ctor()` | `0x0a000001` | `0x0a000003` | 2 |
| parked-frame | `System.Exception::.ctor(string)` | `0x0a000003` | `0x0a000002` | 1 |
| parked-frame | `System.Action::.ctor(object,nint)` | `0x0a000004` | `0x0a000003` | 1 |
| parked-frame | `SharpForge.Runtime.Async::Start(Action)` | `0x0a000005` | `0x0a000004` | 1 |
| parked-frame | `System.Threading.Tasks.Task::Delay(int)` | `0x0a000006` | `0x0a000005` | 1 |
| parked-frame | `System.GC::Collect()` | `0x0a000007` | `0x0a000006` | 1 |
| parked-frame | `System.Console::WriteLine(string)` | `0x0a000008` | `0x0a000007` | 1 |
| parked-frame | `System.Object::.ctor()` | `0x0a000002` | `0x0a000008` | 4 |

The image changes come from A05 commit `dcff5a876`: `codegen/exception-emission.js` records the actual catch end, and `symbols/exception-identity.js` maps the specific `Exception` alias to its canonical CLR identity. The image schema already permits optional `handlerEnd`; `exceptionRegionEntries` validates it when supplied, and `source-eh.js` retains its fallback for older catch metadata without that field. No image-format or schema-version change is required. The resulting normalized method body is unchanged apart from its artifact-local MemberRef IDs.

All spans, the other two images, type identities and symbols remain byte-identical. `nested-fault.cs` is a separate safepoint execution fixture and is not consumed by `gen-schema-fixtures.js`, which uses `nested-finally.cs` instead. Historical execution evidence and unrelated golden collections remain untouched.

The five-file focused A00 validation passed **81/81**, including inventory reproduction, root-manifest checks, both VM safepoint fixtures, the new caught/uncaught nested-fault regressions, schema generation twice, and typed-IR/schema validation. The separate compatibility suite passed **2/2**: both canonical/explicit and legacy alias/inferred catch metadata validate, load and produce `inner`, `catch`, `outer`. It checks target 11, exclusive handler end 16, the catch's final jump and the protected-region jump used by the old fallback.

Commands, resource settings, raw logs, before/after hashes and the complete JSON field/member diff are retained in [the A00 contract repair evidence](https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/integration-validation-20261004/a00-contracts/README.md). The broader 28-file A00 attempt stopped at the registration harness's nested run-slot deadlock; it has no completed summary and is not a full-area pass. The incomplete log and the explicit abandoned-lock recovery are retained. No wrapper bypass or omission of registration tests was used to claim success.
