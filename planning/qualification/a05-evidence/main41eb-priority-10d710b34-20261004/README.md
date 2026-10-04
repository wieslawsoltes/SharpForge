# Main-41eb priority measurements and CPU diagnostics at 10d710b34

This archive preserves 57 original files, 2,160,010 bytes, from the completed
priority qualification and two bounded CPU diagnostics. Every raw file is copied
byte-for-byte. `manifest.json` binds its original absolute path, archived path,
byte length, SHA-256 and Git blob identity. The two executed `.mjs` drivers are
stored as `.mjs.txt`; `driver-path-map.json` records this archival naming change.
Their source bytes, embedded historical imports and executed argv are unchanged.
The manifest, path map and this README are additive archival metadata.

All three activities identify revision
`10d710b349d581b88c0013ce8571bd963bfdb839`, tree
`45d4897ecdffb72b3ea738e87b935f25218850af`. The execution journals record a clean
checkout before and after. These are observations of that revision, before the
subsequent dispatch/return optimizations and integration repairs. They do not
qualify later runtime revisions, another host, native throughput or browser timing.

## Original priority qualification

The two JSON reports in `priority/` retain the complete samples and exact
commands; each adjacent `*-execution.json` records the wrapper command,
environment, raw exit status, revision/tree and stdout-log digest. Both report
Node 24.19.0, Linux x64, native ABI64, limits 1/1/512, seed 12012, 10,000 bootstrap
resamples, and a 900-second command deadline. No target, fixture or protocol was
changed for this archive.

| Target | Required speedup | Observed speedup | Original 95% interval | Disposition | Raw exit |
|---|---:|---:|---|---|---:|
| Source Fibonacci | 1.5× | 1.4510463640555287× | [1.302256767145124, 1.5735675505599265] | Inconclusive | 2 |
| Virtual cache | 3× | 1.982710053204195× | [1.9063535270623788, 2.0961506499612357] | Missed | 1 |

Each report retains **104 observations per mode**: one first execution, three
warmups and 100 measured observations. Both reports have zero execution errors
and preserve unchanged start/end source identities. Correct execution does not
convert either performance disposition into a pass. The first/warmup observations
remain in the original reports and are excluded from measured summaries according
to the original protocol; no new filtering or winner selection was performed.

## Virtual CPU diagnostic

`virtual-cpu/` contains the original candidate CPU profile, observation record,
guest attribution summary, checkout inventory, driver, execution journal and log.
The driver performs four unprofiled alternating baseline/candidate pairs, then
profiles eight complete candidate executions at a 100-microsecond requested
sampling interval. Each profiled execution has 280,014 guest instructions and
the unchanged fixture result, 140,000. The profile contains 10,228 samples.

`guest-summary.json` narrows attribution to samples whose ancestors include
`runQualificationVM`, counting recursive frames once per sample for inclusive
totals. That subset contains 9,333 samples and 1,634,717 attributed microseconds.
This filter is stated in the original summary; the complete raw profile is retained.

The proposed verified-method witness cache was declined after this diagnostic.
The original `verifiedMethod` row in `guest-summary.json` attributes **2,619
inclusive microseconds / 1,634,717 guest microseconds = 0.16021121698740515%**,
with 1,573 self microseconds (0.09622460646093484%). This is the source-supported
basis for judging that candidate a low-priority cost, as reported by the profiling
owner and coordinator. No witness-cache implementation or measured benefit is
claimed. CPU attribution is neither an end-to-end speedup measurement nor an
estimate that removing the function would produce an equal speedup.

The driver's SHA-256 is
`e6a25e48bae8401b944a2e27affc5f31e91884e98bd1eb77d468c38e7d0bb400`,
independently confirmed by the profiling owner and the archived bytes. The raw
execution journal preserves the actual child argv and Node 24.19.0. It does not
contain the outer Python capture-launcher argv; no reconstructed launcher is
substituted into that journal.

## Source CPU diagnostic

`source-cpu/` contains all 40 original CPU profiles, `summary.json`, the execution
journal, stdout log and the exact external driver as inert text. Its SHA-256
`cfc7623e9ceb9777fbde7d94c8c15aa8a85c8c1537439e107a8f2b29e3205544`
matches the contemporaneous `execution.json` field. That journal records exact
argv, resource variables, revision/tree, clean before/after state, timestamps,
exit zero and log digest. It does not record a Node-version string; the Node
version of the other commands is not inferred for this process.

After four unprofiled alternating pairs, the driver profiles 20 observations per
mode, with the candidate group followed by the baseline group. Both modes report
**5,253,940 guest instructions** and check the Fibonacci output `6765\n`.
The candidate has 7,120 samples and the baseline 11,288. The requested sampling
interval is 100 microseconds. Host GC occurs before each profile starts; guest
execution and profiler start/stop work are present in the raw profiles.

The original summary's percentages include non-package frames, notably inspector
overhead. They are preserved as recorded rather than silently renormalized into
guest-only percentages. These diagnostic observations are not the paired
qualification protocol and do not replace either 100-pair report above.

## Scope and preservation

No tests, builds, generators or new performance measurements were run to create
this archive. File equality and SHA-256/Git blob identity were checked against
all 57 original inputs. The original issue criteria and historical acceptance
ledger are unchanged. Later hosted performance, complete-suite, native, browser
and build-size qualification remain separate evidence obligations.
