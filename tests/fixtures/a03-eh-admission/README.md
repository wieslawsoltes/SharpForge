# Runtime EH admission reference plan

Implementation-ready; all local qualification is pending the serial slot.
The fixture writer is independent of the compiler, EH tree and admission API.

Fourteen .NET ILVerify10.0.5/SDK10.0.201 cases are prepared: valid catch, finally,
fault, rethrow and first-try branch entry; invalid ordinary/switch region exits,
try-interior/catch entry, leave into a try interior, ret/fallthrough exits and
finally/fault leave escapes. Each negative must report its intended native
diagnostic, following the pinned [ILVerify catalog](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/tools/ILVerification/VerifierError.cs).
Invalid assemblies are never executed. The capture retains raw output before
parsing, actual admission issues and tool/input/assembly hashes.

Eight admission tests cover those cases plus malformed geometry/boundaries,
successful stack proofs, existing coincident catch seeds/reentry, cached method
reuse without PE reread, limits/cancellation, the no-handler path and continued
filter rejection. Three private-seam tests compare standalone/decoded outcomes
and ensure bounds precede bitmap allocation. Existing standalone EH, runtime
and entry-state contracts remain in the affected suite.

At the scheduled slot, retain a failing-before proof for the named ordinary
branch-exit regression against parent8336790a, then native capture, focused and
affected tests, paired benchmark-handler-entry.mjs controls (no EH/catch/finally),
and required static/structure checks, all under one serial limiter reservation.
Use identical harnesses and exact parent/candidate sources, retain chronological
samples and report medians/p95 with the shared-host limitation. No native or
performance result exists yet; broader engine/platform qualification is staged.

```sh
node scripts/limited.js node tests/fixtures/a03-eh-admission/capture.mjs tests/fixtures/a03-eh-admission/native.json
node scripts/limited.js node --test --test-concurrency=1 tests/a03-07-eh-admission.test.js tests/a03-06-eh-decoded.test.js
```
