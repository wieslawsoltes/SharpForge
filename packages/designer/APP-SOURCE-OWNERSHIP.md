# Running app source ownership

`DesignerAppHost` starts a separate runtime worker and managed UI host for each app generation. Source freshness uses an immutable
projection of the complete workspace. Source edit authority additionally requires the exact files supplied to that app's compiler.
Neither an active editor nor a shared workspace makes another project's source part of the running app.

The Studio compile adapter returns `compilationUris` on each successful build. These are the exact URI strings from the build's
actual input files. `DesignerAppSourceOwnership` accepts the same constructor option, validates that each input exists in the full
projection, and stores a sorted, frozen copy. URI identity is case sensitive. The set is bounded to 1,000 unique files; malformed,
duplicate, or unknown entries fail with `SFDA0012`. A missing or empty set leaves an app available for execution and inspection,
while source edits and code updates remain unavailable until a restart supplies explicit compilation evidence.

Before changing source, the caller invokes `assertSourceOwnership({uris})` with every intended target. All targets must belong to
the captured compilation and the entire current workspace must match the app's current or authorized source projection. This check
runs before source writes. `authorizeSourceChanges({before, after})` then validates complete immutable before/after receipts and
independently rejects changes to any file outside the compilation. A receipt cannot authorize a different project, newly added
files, or removal of a compilation input. The caller's transaction remains responsible for rolling back a failed source operation.

Every successful code-update build must return the same compilation URI set, irrespective of ordering. A project switch, a changed
project reference, an added or removed input, or missing membership evidence rejects the compiled result before a worker Hot Reload
request. Only the exact returned executable can then be applied, and the running source projection advances after the target worker
acknowledges the update. Interrupted updates keep their existing uncertain-state guard.

Restart is the explicit operation that can adopt a new compilation set and new complete workspace projection. It creates a new
generation and preserves the prior runtime if compilation or startup fails. Newly generated partial files therefore require restart
before they become eligible for live source edits. Existing compiled partial files can participate in one atomic source receipt.

The main Studio session bridge uses the same ownership helper and must supply its original launch evidence. It never substitutes
the current workspace or current project selection for an absent launch receipt.

Focused cases are in `tests/a18-app-host-compilation-ownership.test.js`; the host's source, cancellation, worker identity, and
artifact regressions remain in the other `tests/a18-app-host-*.test.js` files. Run them together in the scheduled completed-scope
validation slot through `node scripts/limited.js`.
