# Runtime EH admission evidence

Qualified product `d5eafbc60` against baseline `8336790a`.
The fixture writer is independent of the compiler, EH tree and admission API.

Fourteen .NET ILVerify 10.0.5/SDK 10.0.201 cases agree: valid catch, finally,
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

The named branch-exit regression fails against baseline `8336790a`. All 11
parent focused/seam tests pass. The dependent no-handler candidate ran the
combined 174-test affected suite and required checks once: 3377 syntax modules,
3373 static modules, zero errors; 271 existing structure findings, none added.
The touched legacy execution profile retains its 466-character maximum line
and shrinks 102 bytes. Byte-identical shared source hashes justify that combined
qualification; the child has only its two intentional additional product paths.

[Qualification](qualification.json) retains failing-before output, shared-source
proof, exact test/check commands and terminal results. [Native capture](native.json)
retains all 14 observations. [Performance](performance.json) retains all 12
chronological samples per control on the same shared host and exact harness.
One fixed baseline → parent → child schedule used one limiter reservation at a
time, concurrency 1 and a 1 GiB Node heap; no full matrix was run.

Per 1000 admissions, baseline → parent median/p95 milliseconds were: no EH
3.340000/4.281542 → 3.338417/4.031500; catch 5.421750/6.092625 →
7.860500/10.441417; finally 4.306041/5.351667 → 6.866958/8.824500.
Root integration review accepts catch +44.98% median/+71.38% p95 and finally
+59.47%/+64.89% for the added bounded lexical checks, with shared decoded
instructions and bitmap. Absolute median costs are approximately 2.44/2.56 µs
per handler-bearing admission. These shared-host samples establish no
significance, causal attribution, noise explanation, speedup or peak-memory
claim. Broader engine/platform and typed-verifier qualification stays open.

```sh
node scripts/limited.js node tests/fixtures/a03-eh-admission/capture.mjs tests/fixtures/a03-eh-admission/native.json
node scripts/limited.js node --test --test-concurrency=1 tests/a03-07-eh-admission.test.js tests/a03-06-eh-decoded.test.js
```
