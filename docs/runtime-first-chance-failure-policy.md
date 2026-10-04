# First-chance callback failure policy

Source, reloaded source and direct-CIL VMs accept the host option
`firstChanceFailurePolicy`. Its two exact values select the boundary behavior
when an exception escapes a managed `FirstChanceException` subscriber:

| Value | Behavior |
|---|---|
| `before-unwind` | The default. Fail fatally when handler search reaches the callback boundary, before callback finally cleanup. |
| `after-unwind` | Select the callback boundary, execute nested and callback finally cleanup cooperatively, then fail fatally. |

Other values, including null and nonstrings, produce `RuntimeLaunchError` with
code `FIRST_CHANCE_FAILURE_POLICY` during construction. This is an explicit host
compatibility choice. The runtime does not select behavior by examining expected
output or guessing a native runtime from an SDK label.

Both modes report a fatal `ExecutionEngineException` and exit status
`0x80131506`. Later subscribers for the original notification, outer catches and
unhandled notifications do not run. Exceptions thrown by cleanup go through the
existing notification/search machinery; if they escape the selected callback,
its remaining eligible cleanup runs before that mode's fatal boundary. Fatal
resource faults continue to bypass notifications and cleanup immediately.

This policy applies only to escaping first-chance subscribers. Ordinary unhandled
exceptions retain their throwing frames before cleanup. In after-unwind mode,
only callback frames retire; the original throwing frames stay inspectable.
The fatal fault exposes `exceptionEventContinuation` for the original captured
notification and `callbackFailure` for the escaping callback or cleanup fault.
These diagnostic objects keep their managed references alive without retaining
a logically active retired callback frame.

Each first-chance notification captures its policy in its continuation. Paused
cleanup therefore keeps the same behavior through local or portable snapshot
restore, even when the destination VM has a different default. Older captured
notifications without the field use before-unwind behavior. Restore rejects
unknown policies and inconsistent unwind boundary or fatal diagnostic state
before mutating execution. Diagnostic root traversal and snapshot copying handle
shared and cyclic object graphs without recursive host-stack growth; malformed
fatal diagnostic cycles are rejected during restore.

`tests/a05-first-chance-unwind-policy.test.js` covers all three execution routes,
nested cleanup and notifications, cleanup throws, both restore forms while paused
inside cleanup, diagnostic GC retention and terminal snapshots, compatibility
with missing policy fields, malformed snapshots, resource-limit bypass and
ordinary unhandled exceptions. Native policy selection and runtime provenance
are documented separately in the native qualification protocol.
