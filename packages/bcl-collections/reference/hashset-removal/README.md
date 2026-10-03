# HashSet removal order reference

The fixture pins SDK 10.0.201 and runtime 10.0.5. It records physical slot order
after direct removal, UnionWith, ExceptWith, IntersectWith, complete removal,
Clear and reuse. Null, duplicate entries, signed Int32 limits, NaN, signed zero
and boxed primitive type distinctions are covered on both SharpForge VMs.
The native source and oracle remain unchanged. The compiled test asserts and
adapts exactly three unsupported `double.NaN` fields to `0.0 / 0.0`, and one
unsupported generic `string.Join(double[])` to equivalent two-element text.
Separate platform tests and independently assembled CIL use actual NaN values
and compare the same native rows. Invalid capacity faults are asserted directly
by their managed type, without a catch-all source clause.
Existing collection mutation-version rules are tested separately;
this order fixture does not claim complete native enumerator parity.

The root validation scheduler captures once from this directory:

```sh
dotnet run --project HashSetRemoval.csproj --configuration Release --verbosity quiet > ../hashset-removal-net10.txt
```

The checked-in output is the native oracle; no timing claim follows from it.
