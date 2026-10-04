# CompareOrdinal range reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project CompareRanges.csproj --configuration Release -- ../string-compare-ranges-net10.json
```

The 58-case capture preserves exact UTF-16 code units, actual integer results,
exception types and argument names. It covers nulls before validation, zero-count
validation, clipped prefix lengths, endpoints, Int32 extremes, embedded NUL and
isolated/split surrogates. The source hash and native toolchain are recorded in the
unchanged output. Tests exercise compiled source on both VMs and independently
assembled CIL. Result magnitude is captured evidence; the public ordering contract
specifies only its sign. This does not qualify culture comparison overloads.
