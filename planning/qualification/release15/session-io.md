# Per-application managed HTTP and numerical acceptance

This additive SF-R015-T04 fixture exercises the merged Studio session, runtime,
networking and numerical implementations. It reuses the existing T12 browser RPC,
production HTTP/CSP loader, session automation helpers and completed-build identity.
The earlier release manifest, leased session fixture and blocker ledger are untouched.

The fixture starts two projects and a second instance of the first project with
three distinct runtime Workers and two compiler Workers. Each application starts
with networking denied. Real UI actions then exercise:

1. A denied managed `HttpClient` call while its numerical worker completes.
2. Explicit session grants that become active only after that session restarts.
3. Three overlapping requests to an owned loopback HTTP server while each
   application's `ParallelMath` job completes in its real numerical Worker.
4. Managed `CancellationTokenSource` cancellation of one pending HTTP request.
5. Grant revocation and stop of another application while the debugger selects the
   surviving instance, followed by that instance's successful HTTP completion.
6. Restart of the revoked application with networking still denied, successful
   numerical work, and independent managed callbacks in all three applications.

The endpoint uses three fixed application tags, one request per armed tag and a
bounded response gate. It records no raw headers, cookies, authorization values,
tokens or remote account information. No Fetch, Worker, compiler, session or
runtime method is replaced. HTTP response gates control the actual local server;
they do not synthesize browser responses. Timings establish overlapping request
windows only, and are not latency or global fairness measurements.

At the scheduled qualification slot, use a clean committed checkout and build it
once through the normal build command. The runner requires the matching clean
`build-identity` manifest and checks asset hashes before and after the scenario,
including the actual served Studio and compiler/runtime worker bytes. Existing
Python Playwright/browser prerequisites must already be installed.

The existing browser selection rules apply: `SHARPFORGE_BROWSER_ENGINE` selects
Chromium, Firefox or WebKit; the corresponding explicit `*_EXECUTABLE` option
must name an existing file. Otherwise the installed Playwright package selects
its pinned browser. This runner never downloads browsers or substitutes a
different browser/package version. An unavailable executable remains a failed,
unexecuted component with a retained capability-failure record and original
diagnostics.

```sh
node scripts/limited.js node --test tests/conformance/release15/session-io.test.js
node scripts/limited.js node scripts/conformance/release15/session-io-run.js --output artifacts/results/session-io-run1
```

The destination must be new. The report includes the exact source revision,
completed build identity, generated C# records, browser identity, phase screenshots,
application/worker identities, per-session runtime metrics, endpoint events and
SHA-256 inventories. Failed, cancelled and incomplete phases remain failures.
The unit tests use synthetic records solely to check this evidence policy.

The adapter waits for the Python process to finish after acknowledging close,
then requires exit code zero and the launcher's final browser session record.
That record must have the matching browser identity, no CSP violations and no
teardown diagnostic errors. A close acknowledgement alone cannot qualify the run.

A successful component run exits **2** with `componentStatus: passed` and
`status: blocked`: host-wide admission/fairness and managed WebSocket integration
remain outside this slice. Failures, missing prerequisites, cancellation, changed
source/build assets or incomplete teardown exit **1**. This fixture supplies no
provider-authentication, downloaded-app export, physical GPU, native runtime or
cross-platform qualification. No validation was run when this implementation was
authored; retain actual reports before claiming coverage or closing the parent.
