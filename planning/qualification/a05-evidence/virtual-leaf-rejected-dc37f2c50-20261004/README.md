# Rejected guarded CIL constant-leaf prototype

The fully guarded prototype is **not suitable for integration**. On the unchanged
20,000-call virtual workload, eight measured alternating pairs gave 190.1338375 ms
median / 213.0606837 ms p95 with `preparedLeafCalls:false` and 558.5326005 ms median /
608.48045455 ms p95 with the option enabled: enabled execution was approximately
2.94 times slower. This is a bounded same-product diagnostic, not the original
100-pair inline-cache qualification. No confidence interval or 3× acceptance is
inferred from this small probe.

Each of all 24 executions checked the original result and counted 280,014 guest
instructions. Each mode admitted 20,002 new logical call IDs per observation.
Enabled execution actually omitted 19,844 constant-leaf physical frames and
39,688 original callee instructions passed through the elision path. The remaining
boundary calls stayed physical. In every measured row, physical frame reuses were
158 enabled versus 20,002 disabled; retirements were 159 versus 20,003. Both modes
allocated zero new warm frame/array storage and one managed object / 32 managed
bytes. Host memory readings are retained observations, not allocation counters.

The prototype preserved quota admission, logical identities, exact instruction and
slice boundaries, original receiver checks, observer fallbacks, weak pool ownership,
retained host setters, exposed frame-index callbacks, epoch invalidation and
single-use call-opcode permission. Its many live descriptor checks cost more than
the entry/retirement they remove. The results reject this implementation; they do
not prove safe physical-frame elision impossible under a different ownership model.

The first focused capture at `d3a7a3e71` passed 115/116. Its only failure was a new
snapshot replay assertion that ignored the existing monotonic frame-ID contract.
Commit `dc37f2c50` corrected that assertion to require the retained high-water mark
and the exact equal admitted-call delta. A separate complete capture passed
116/116 with no skips. Both raw outcomes are preserved; no runtime code changed
between them.

Before and after the probe, every one of 4,670 materialized tracked blobs matched
the committed index, the worktree was clean, and all 28 workspace package links
resolved into that same checkout. The child used Node 24.19.0 on Linux x64,
`--max-old-space-size=512`, one worker and one run slot. Actual V8 heap-size limit
was 738,197,504 bytes. Captures retain exact commands, UTC times, exits, tree IDs,
source hashes, cold timings, every first/warm/measured observation and memory
readings. The source `.mjs` and Python scripts are preserved byte-for-byte with
`.txt` archive extensions and mapped back to their executed paths in the manifest.

The three runtime/test commits remain on `codex/a05-virtual-witness-20261004` as a
rejected, correctness-tested prototype. This evidence commit can be cherry-picked
independently; do not merge its runtime ancestors merely to retain the report.

The archived failing Node log includes two whitespace-only diff lines. They are
kept byte-identical to the original capture; `git diff --check` reports those two
raw evidence lines, and no implementation source whitespace errors were reported.

`rejected-runtime-10d710b34-to-dc37f2c50.patch.txt` is the complete binary-capable,
full-index diff from the measured baseline tree to the rejected measured runtime
and tests. The manifest records both commit/tree identities, exact generating
argv, byte count and SHA-256. Starting at that exact base tree, applying it to the
index reconstructs final tree `39ee39ebbf2966a37183a2f7b1dfb269fedfd2d5`. The
patch excludes both observation-archive commits and any later batch experiments.
