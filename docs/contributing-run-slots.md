# Local run-slot inheritance and recovery

`scripts/limited.js` and `scripts/planning/run-tests.js` preserve the configured
machine-wide independent-run limit, V8 heap cap and serial manifest-test policy.
An outer limited command can synchronously invoke a nested manifest runner
without requesting a second independent slot. The owner explicitly passes
`SHARPFORGE_RUN_SLOT_LEASE` to its child environment. A nested acquisition checks
the exact directory, slot inode, nonce, metadata and live owner before borrowing
that lease. A borrowed release cannot delete the parent's slot. Unrelated
commands without the inherited capability continue waiting for a free slot.

This is local process coordination, not a security boundary against another
process running as the same OS user. Child commands must preserve the established
serial execution policy; the capability is not permission to launch independent
parallel heavy jobs inside one owner. No `CI=true` bypass or larger concurrency
setting is introduced.

On Linux, an owner records its procfs-visible PID, process start tick and boot
identity. A process can see a different `process.pid` inside a PID namespace;
the reused namespace-local number alone cannot establish that the original owner
still exists. The procfs checks also reject PID reuse and zombie owners. Other
platforms retain the ordinary owning PID liveness check and nonce/inode binding.

The slot directory remains compatible with older wrappers that parse every lock
file as a numeric PID. On Linux where PID 1 is confirmed live, the numeric file
uses that conservative guard; elsewhere it uses the owning PID. Rich metadata
lives in a sibling directory named by appending `.leases` to the slot-directory
path. Metadata is bound to the lock's device and inode and is published before
the complete numeric lock becomes visible. Older wrappers cannot interpret the
metadata as an invalid numeric owner or delete a live guarded lease.

Normal owner release and process exit remove only the exact owned inode/nonce
and its metadata. A new wrapper can reclaim an abruptly terminated new-format
owner using the recorded process identity. A per-inode cleanup election keeps
new contenders from deleting a replacement lease during stale cleanup.

Two mixed-version limits fail conservatively:

- An older wrapper cannot recover a crashed Linux guarded lease by itself. A
  metadata-aware wrapper must perform recovery; normal cleanup is compatible.
  Automatic stale cleanup is limited to those Linux guarded leases. A dead
  ordinary-PID lease on another platform requires explicit recovery because an
  older wrapper could otherwise race the metadata-aware cleanup election.
- A dead legacy PID-only record has neither a trustworthy namespace identity nor
  the new cleanup-election protocol. New wrappers report
  `RUN_SLOT_LEGACY_STALE` instead of racing old cleanup code. Verify the originating
  run has ended before removing that specific old record. A cleanup process
  killed during its own short election reports `RUN_SLOT_CLEANUP_INTERRUPTED`
  rather than silently admitting another job; its stale reaper record likewise
  requires verified recovery.

Malformed, altered, foreign-directory, expired or replaced inherited leases fail
with `RUN_SLOT_LEASE_INVALID`. Rejection does not release the referenced slot.
The focused tests exercise real child reuse, nested synchronous manifest runs,
independent waiting, owner cleanup, stale metadata, Linux identity changes and
legacy numeric-lock compatibility. Validation results remain separate from this
protocol description.
