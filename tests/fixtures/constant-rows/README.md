# Typed Constant row oracle

`image.mjs` uses the public typed-row API to emit a minimal managed PE containing
Field, Param and Property defaults inserted out of Constant-table order.
The .NET 10.0.5 SRM oracle inspects sorted parent handles, flags, `GetDefaultValue`
handles, raw blobs and values. This is metadata inspection evidence; source
binding and executable class emission are separate capabilities.

```sh
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 \
  node scripts/limited.js node packages/cil/tools/validate-constant-rows.mjs
```

Use `--capture-fixtures` to deliberately regenerate `native.json`. The SDK build
runs with `-m:1 --disable-build-servers`, disables shared compilation, writes only
to a temporary directory and cleans it after the capture. No network is needed
once the .NET 10 SDK is installed.

The paired builder benchmark is
`node scripts/limited.js node packages/cil/tools/benchmark-constant-rows.mjs`.
Run the same benchmark text from a checkout of baseline
`9e4fd1fd7febeb4c0118a09adc415bf016e811b9` using `node --input-type=module -`
to resolve its existing CIL package. The relevant constructor and definition
registry blobs match this branch's pre-change base `681db84f`.
Results in `packages/cil/benchmarks/constant-rows-node24.json` record 31 samples on
Node 24.21.0/Apple M3 Pro. Shared host, no allocation profiler or general speedup claim.
