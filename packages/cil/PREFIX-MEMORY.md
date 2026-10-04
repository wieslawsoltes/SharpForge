# Memory-prefix validation

`validateMemoryPrefixes(bytes, options)` validates `volatile.`, `unaligned.` and
`no.` targets and rejects repeated occurrences of those prefixes within a group.
It returns the caller-owned group records from `decodeInstructionGroups`; offsets
are byte positions in the supplied method code. Existing decoding, writing and
execution APIs do not implicitly opt into these semantic checks.

The rules follow ECMA-335 sixth edition III.2.2, III.2.5 and III.2.6:

- `unaligned.` accepts indirect loads/stores, instance-field loads/stores,
  `ldobj`, `stobj`, `initblk` and `cpblk`.
- `volatile.` accepts the same targets plus `ldsfld` and `stsfld`.
- The first two prefixes may appear together in either order. Alignment remains
  limited to 1, 2 or 4 by the existing structural decoder.
- `no.` requires each requested fault-check bit to apply to its target. The type
  bit applies to `castclass`, `unbox`, `ldelema`, `stelem` and `stelem.ref`; range
  applies to element loads/stores and `ldelema`; null also applies to instance
  fields, `callvirt` and `ldvirtftn`. Unknown bits are structurally rejected. Zero
  remains representable as no requested checks, but still requires an allowed target.

By default, `no.` is rejected as unverifiable even when its target/flags are
correct. `{ allowUnverifiable: true }` performs correctness-only target checks.
Success never establishes whole-method verifiability: stack types, referenced
tokens, memory safety, other prefix semantics and exception flow are separate.
The duplicate check is the strict policy required by #2412. It is independent of
runtime tolerance: the existing captured CoreCLR prefix fixture executes a
repeated `volatile.` chain that this API rejects. Binary grouping still preserves it.

`memoryPrefixDiagnosticCatalog` is frozen. New semantic failures are `CilError`
with `code`, offending prefix `offset`, `prefix`, `target` and `targetOffset`:

| Code | Meaning |
|---|---|
| CILPM0001 | Repeated memory prefix |
| CILPM0002 | Prefix on a non-target opcode |
| CILPM0003 | Requested `no.` check is unavailable on that target |
| CILPM0004 | `no.` is forbidden by default verification policy |

Existing structural errors retain their existing diagnostics. Input, instruction,
aggregate switch-target and per-group prefix limits are inherited unchanged from
the group decoder (16 MiB, one million, one million and 64). Lowerable
`maxInstructions`, `maxPrefixes` and `signal` options pass through. The semantic
pass is O(instructions + prefixes), uses a scalar duplicate mask per group and
allocates no new successful-path records beyond the existing decoded groups.

Validation: nine focused cases and existing prefix/opcode/CIL compatibility pass
209/209. Pinned ILVerify 10.0.5 (SDK/reference pack 10.0.201/10.0.5) agrees with all
eight captured decisions: four valid chains accepted, two forbidden targets
rejected, a repeated volatile rejected and no. reported unverifiable. The raw
capture is retained with tool/source/image hashes. No new runtime execution
semantics are claimed; source VM/browser/Rust/platform qualification stays staged. Required checks pass
2678 syntax modules and 2674 static modules with zero errors. Structure reports
269 existing findings, none in this batch's files.

The unchanged grouping API and the opt-in validator were measured with two warmups
and seven chronological samples on Apple M3 Pro / macOS ARM64, Node 24.21.0:

| Prefix groups | Grouping median / p95 ms | Validation median / p95 ms |
|---|---:|---:|
| 1000 | 0.859958 / 1.071125 | 0.944375 / 1.058375 |
| 5000 | 2.291333 / 3.173833 | 2.734834 / 3.307042 |

This measures added semantic work, not an old/new regression; existing grouping
source is unchanged. [Raw samples](benchmarks/prefix-memory.json) retain heapUsed
deltas, provenance and the command. Heap deltas are not allocation totals, peak
memory or RSS. The process ran alone in the team's serial slot on a shared host,
with no claim of significance, general speedup or memory reduction.

Reference: [ECMA-335 sixth edition](https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
