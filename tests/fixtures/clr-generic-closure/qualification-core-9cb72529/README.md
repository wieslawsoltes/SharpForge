# First core failure for generic instantiation

This directory preserves the first required `core` failure for [PR #4589](https://github.com/wieslawsoltes/SharpForge/pull/4589).

- Head: `9cb725291ef2ae28a68655a5f47901ec73bf068a`.
- Base: `c7e19ec89272f8a3193fc5720e403941e5a0520b`.
- Tested synthetic merge: `b715200051132537ea729e924f8259706e199624`.
- [Workflow run 37246720920, attempt 1](https://github.com/wieslawsoltes/SharpForge/actions/runs/37246720920).
- Core job: `111565960135`; failed in `npm run check` on 2026-10-05.

## Observation and correction

The static checker reported one missing allowance for the already measured
`packages/clr/tools/benchmark-generic-instantiation.mjs` driver: three dynamic
imports, at lines 17–19, with SHA256
`435545681efeacd533534203b8e0ae3c5d5493325dacaa32e40fac3f7b562da6`.
The benchmark imports an operator-selected trusted local CLR entry and two
fixed test helpers. Managed metadata does not select host JavaScript modules.
The driver's own source snapshot occurs after those imports; this policy entry
makes no pre-import source-enforcement claim.

The correction adds one exact path/hash/count entry. It preserves the driver,
product, observers, benchmark protocol and previous measurements unchanged.
The existing checker still rejects changed source, wrong counts and stale entries.
An independent source review accepted this narrow allowance. The new row is
inserted before the unchanged first policy entry to avoid the competing insertion
gaps found in main; all existing entries must survive integration.

## Evidence

[The complete decoded job log](core-111565960135.log.txt) is retained as returned
by the GitHub job-log tool: 278,077 UTF-8 bytes, SHA256
`332633ef43cb50e0015bfdf2d100a6b3469d5b2c4cbbc79651f0d297d2f0a120`.
[The failure record](first-failure.json) includes the job-step results, source and
policy identities, exact correction and independent review disposition.

This first run is a failure. Its later `npm test` and `npm run build` steps were
skipped. A later successful run does not erase or reinterpret this result.
This directory does not replace the separate native, focused-test or benchmark
evidence, and it does not claim that Project 6 or issue #2460 is complete.
