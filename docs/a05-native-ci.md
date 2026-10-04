# A05 native qualification

The focused workflow `.github/workflows/a05-runtime.yml` is additional qualification for Project 7. It runs on explicit dispatch,
or on a pull request whose title contains `SF-A05` and which has the existing `full-ci` label. It has no dependency on unrelated
browser, application build, or full unit-test jobs. Existing required CI policy is unchanged.

The six serial cells use the existing `ubuntu-latest`, `windows-latest`, and `macos-latest` runner channels, Node 22,
and SDK 8.0.x or 10.0.201. Actions use the repository's pinned commits. The .NET setup action's `dotnet-version` output
provides the resolved exact SDK, which is pinned in `global.json` and checked before qualification. The output contract
was verified in `actions/setup-dotnet`'s `action.yml` at the exact pinned action commit. Each cell retains OS/architecture, runner image, Node, SDK,
runtime and revision provenance, and uploads `artifacts/a05-native` even on failure. Hosted runner images can change; their
recorded version is evidence, not a claim of immutable machine identity. The remote job gives its one serial Node child
a 4 GiB V8 heap cap for the large numeric corpus; it does not change local resource limits or enable concurrent cases.
The exact `NODE_OPTIONS` setting is recorded in provenance alongside the concurrency of one.

The report records the tested `HEAD` and tree hash, tracked-only Git status, and public workflow/run/attempt identifiers.
Pull-request reports also retain head/base revisions and repositories; the default workflow checkout tests the merge revision,
not the pull request's head alone. Any tracked edit blocks all native cases, and CI additionally requires `HEAD` to equal
`GITHUB_SHA`. The workflow's intentional untracked `global.json` is permitted and recorded separately with its exact contents
and SHA-256; untracked artifact files do not make the tracked tree dirty. An absent SDK selection file is recorded explicitly.
The SDK 8 channel resolves to an exact version per run, rather than claiming an immutable patch across runs. `dotnetRuntimes`
lists installed runtimes; it does not prove the native guest process used a particular runtime patch such as 10.0.5.

```sh
node scripts/a05-native-qualification.js --list --sdk 10.0.201
node scripts/limited.js node scripts/a05-native-qualification.js --sdk 10.0.201 --framework net10.0 --output artifacts/a05-native
```

The SDK must be selected before starting the second command, for example with an appropriate `global.json`. CI creates an
exact SDK pin with roll-forward disabled. Fixture projects created outside the checkout also preserve the selected SDK.
Every fixture gets a separate bounded child process. The aggregate `qualification.json` is checkpointed after every case;
each case retains its command arguments, evidence directory, exit code, signal, stdout and stderr. Independent cases continue
after a failure. A missing SDK blocks every case and fails qualification. Interrupted setup or execution is finalized as failed.

Coverage includes value storage/layout/boxing, virtual/interface/generic calls, calli, varargs, static initialization, nullable,
enums, strings, tokens, assignability, exceptions, two-await async replay, synchronization, guest exception events and unsafe
memory. First-chance handler failure uses the versioned .NET 8/10 fail-fast contract; unhandled callback failures use a separate
expected-abnormal-exit mode. These outcomes do not count as successful normal process termination.

The current plan contains 32 independent cases, including the actual managed virtual-delegate and multicast protocol.
SDK 10 can qualify all 32; SDK 8 has 29 eligible cases and three explicit numeric-policy exclusions. These are plan counts,
not recorded execution results. Earlier retained reports describing a 31-case plan keep their original revision and counts.

The conversion policy and large numeric oracle pin the .NET 10 JIT. Their .NET 8 cells are explicitly `unsupported` and never
count as passes; a cell with only passes and declared unsupported cases is `partial`, not a full pass. On .NET 10 the native
generator writes fresh source/output/hash provenance under artifacts, then `SHARPFORGE_NUMERIC_ORACLE_DIR` directs all three
VM routes to that evidence. A failed capture blocks its replay. Checked-in reference files are never overwritten by this workflow.

The runtime-fault, Decimal and unsigned-widening expected outputs were recovered from the existing native qualification
scripts and committed reference trace. Adding the workflow does not establish new native results. Each OS/SDK claim remains
pending until its current-revision report records an actual execution result. Generated assemblies, logs and fresh oracle
payloads are workflow artifacts and must not be committed as product dependencies.

The memory capture tool that requires a separate repository-pinned oracle environment remains available independently.
This SDK matrix runs its authored source fixture through the shared same-DLL harness, with explicit unsafe compilation.
