# Captured evidence and remaining qualification

The final generated-example and golden refresh is implemented. Further focused,
full and reproducibility reruns are deliberately deferred to the larger integrated
qualification batch, following the user's 2026-10-03 direction to prioritize
implementation and merging. No item is marked Done from these partial captures.

Existing local evidence on macOS arm64, Node 24.21.0 and npm 11.19.0:

- Core check covered 409 JavaScript modules; all 2,841 tests passed at `4c06dc9`.
  The structure check was advisory; new owned modules were subsequently formatted
  within its 500-line / 40,000-byte / 160-column limits. Inherited advisories were
  not baselined away.
- Actual double build at clean `b07a931a29dd2fc23a800282a8a6d14bfd11c5cf` produced
  identical bytes for 877 outputs: 850 dist files, 25 workspace tarballs, standalone
  HTML and browser ZIP. Both runs also matched all 134 A00 compiler golden examples.
  Source ZIP SHA-256 was
  `b0323ce17bd5849111f64e79759b829cabc6e30b77c26f85f3ceda2f104d0d95`.
  The two observed build times were 2684.79 ms and 2647.43 ms; these are two samples,
  not a percentile/performance qualification.
- An actual npm-offline rebuild at that same commit matched every release payload
  and dist hash with zero explained or unexplained differences. Its overall result
  correctly failed because the example freshness check found ten stale artifacts.
  The report explicitly states that kernel network isolation was not qualified on
  this local macOS invocation.
- The same capture verified 136 links across 53 tracked Markdown documents.
  No external URL was fetched by the local link checker.
- Six actual generators in forward/reverse order produced identical outputs.
  The stale artifacts and generated Studio mirror are now refreshed as described in
  [the prerequisite review](generated-example-refresh.md). Old/new CIL behavior is
  identical for the three managed examples. The reviewed golden update changes
  exactly two designer source-example records and eleven corresponding dist records.
- Twenty-four focused tests, including the new semantic example checks, passed on
  the working tree before the final commit. They exercise real npm offline cache
  miss rejection, exact-source tampering, manifest byte flips, archive bounds and
  symlinks, missing runner/artifact rejection, generated-mirror freshness, and
  cancellation/timeout cleanup. Actionlint passed for the new workflow.

Reports remain under `artifacts/results/repro/`; historical pre-refresh inputs,
failure reports, execution comparison and golden diff remain under
`artifacts/repro-examples-before/`. They must not be relabelled as final-head passes.

Remaining: final committed core and repro batch, final freshness pass, independent
Linux and Windows captures, cross-runner hash aggregation, Linux network-namespace
rebuild, and an exact published-tag asset comparison when a qualifying release
exists. The scheduled external-link job has not been executed. No release was
published, signed or deployed by this work.
