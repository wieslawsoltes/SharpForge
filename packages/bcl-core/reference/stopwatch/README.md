# Stopwatch native reference

This program runs against SDK 10.0.201 and CoreCLR 10.0.5. It records the real
public declared Stopwatch metadata, preserving the distinction between the
Frequency/IsHighResolution readonly fields and accessor methods. The source and
runtime assembly SHA-256 digests and exact runtime assembly identity are included
in the output. The checked-in Linux x64 capture contains 54 duration vectors and
20 public metadata records.

The deterministic vectors call the public `GetElapsedTime(long, long)` method
with exact Int64 timestamps, including negative deltas, subtraction wraparound,
values beyond binary64's consecutive-integer range and TimeSpan formatting
boundaries. Separate ordinary Stopwatch calls capture state-transition invariants
without asserting host timing or changing private fields. No injected-clock
simulator or reflection mutation is presented as native execution.

The JavaScript execution profile uses the 1 GHz frequency of the pinned native
Unix implementation. Capture on a Unix .NET host; Windows performance-counter
frequency is platform-dependent and is not asserted to match this profile.

```sh
dotnet build StopwatchReference.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/StopwatchReference.dll ../stopwatch-net10.json
```

Root captures the program once in the shared serial validation lane. The
committed source remains unchanged after capture; ordinary tests read the JSON
without invoking .NET. Stopwatch's reference implementation is pinned at:

- https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Diagnostics/Stopwatch.cs
- https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Diagnostics/Stopwatch.Unix.cs

TimeSpan's existing runtime representation exposes floating-point total
milliseconds and seconds. Stopwatch retains exact duration ticks privately; the
separate generic TimeSpan totals prerequisite reads these ticks to avoid double
rounding. This batch does not claim a new public TimeSpan.Ticks or
TimeSpan.ToString implementation.
