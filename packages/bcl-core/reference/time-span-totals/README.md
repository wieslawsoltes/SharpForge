# Exact TimeSpan totals reference

This fixture uses SDK 10.0.201 and CoreCLR 10.0.5. It captures the public
TimeSpan(long) constructor and both existing total getters for 19 values,
including Int64 endpoints, TotalMilliseconds clamping, exact values beyond 2^53,
zero and negative durations. The source hash is embedded in the JSON.

```sh
dotnet build TimeSpanTotalsReference.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/TimeSpanTotalsReference.dll ../time-span-totals-net10.json
```

The corresponding generic runtime helper reads private exact tick payloads
produced by Stopwatch. It preserves existing TimeSpan factories and legacy
millisecond payloads. No TimeSpan constructor or additional public API is
registered by this prerequisite. Native source:

https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/TimeSpan.cs
