# Metadata generation qualification: first observations

The first native capture and both strict provenance checks succeeded on source
`8b9b74f6b7b8faf1692409987da2af4ab4e8b3d5`. The first eleven-file Node gate
failed one boundary assertion: **51 tests, 50 passed, one failed, no skips or
cancellations**. Performance has not run. The heavy slot was released immediately
after that failure; no product or test correction is included in this evidence.

## Recorded phases

| Phase | UTC start | UTC finish | Exit |
| --- | --- | --- | ---: |
| Native capture wrapper | 2026-10-04 17:29:08.307 | 17:29:14.111 | 0 |
| External strict verification | 2026-10-04 17:30:41.328 | 17:30:41.645 | 0 |
| Retained strict verification | 2026-10-04 17:33:31.975 | 17:33:32.215 | 0 |
| Eleven-file Node gate | 2026-10-04 17:33:46.395 | 17:33:52.057 | 1 |

`execution-first/` retains each wrapper's complete execution JSON, stdout and
stderr byte-for-byte. The Node output is the actual spec reporter output, not
fabricated TAP. `root-run-step.py.txt` is the unchanged outer recorder source,
SHA-256 `e38cfdd8e1141467662cce5bb98a5d39ee406ef613b46e1d8c37ee098c56e0c7`.
The wrapper records exact commands, working directories, selected environment,
UTC times, output hashes, status and source snapshots before and after each run.
All four snapshots report unchanged tracked source.

## Native scope and retention

The actual observer used SDK **10.0.201**, runtime/reference pack **10.0.5** and
the pinned Roslyn installation. The retained `../reference/native.json` is
422,072 bytes, SHA-256
`b212069f11b57db48ef2c2d6cd25e87f75fb667f23a2833de7a54df80121aa31`.
Its source inventory covers 376 files. All four workload commands—observer build,
mixed-corpus creation, original observation and mixed observation—exited zero
with null signals, and have complete retained raw stdout/stderr.

The existing toolchain resolver's version probes have resolved identities in
the record but **do not have retained raw subprocess outputs**. Raw command
provenance therefore covers the four workload commands, not every subprocess
used by the resolver. No broader subprocess-completeness claim is made.

| Replayed facts | Original corpus | Mixed corpus |
| --- | ---: | ---: |
| Generations | 3 | 3 |
| Current raw rows across generations | 77 | 77 |
| Historical row checks | 49 | 48 |
| Entity introduction mappings | 72 | 75 |
| Heap introduction mappings | 137 | 148 |
| Heap values | 105 | 122 |
| Explicit stricter user-string boundaries | 18 | 12 |

The strict user-string boundary counts identify deliberate rejection differences
from permissive native empty-string reads. They are not counted as value parity.
The observer reads metadata and does not execute the edited methods or apply
runtime updates.

`native-retention.json` inventories the exact twenty retained paths and confirms
source/retained byte equality for all 542,811 bytes. `native-retention.py.txt`
records that copy operation. The original Portable PDB corpus was verified before
and after capture and remains unchanged. Temporary observer project/output and
SDK/Roslyn/runtime binaries were not retained as fixture payloads.

## First gate failure

`tests/a03-24-metadata-generation-boundaries.test.js:60` appends the generation-2
fixture to a baseline while specifying generation 1. The assertion expects
`MD_GEN_IDENTITY`; the product instead returns `MD_GEN_MAP` with
`EncMap inserts must be contiguous`. The actual map refers to rows introduced by
the missing generation, so current map validation runs before the Module ordinal
check. The first failure and stack trace are retained without changing the
assertion or treating the rejection as a pass.

`first-gate-retention.json` retains raw counts and hashes for all twelve wrapper
evidence files, plus 68 additional test/manifest/fixture/wrapper input hashes.
Its accompanying `.py.txt` is the retention script. Source review proposed
checking the already-parsed single Module ordinal before aggregate map/heap
interpretation. That proposal has not been applied or tested in this evidence.

The frozen `../validation-plan.json` remains the original preparation plan.
Actual observations belong here and in the raw records; its prepared-state
wording is preserved as the protocol's history. Browser, other native hosts,
performance and build/core qualification remain pending.
