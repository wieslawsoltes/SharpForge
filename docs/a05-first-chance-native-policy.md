# First-chance failure compatibility and native provenance

First-chance subscribers may observe a nested exception raised by another
subscriber. An exception escaping the callback is fatal. The callback's own
cleanup differs between the legacy exception engine and the managed exception
engine observed in the retained .NET 10 jobs. This does not change the VM's
default top-level unhandled policy: preserve the throwing frames before unwind
for inspection.

`firstChanceFailurePolicy` explicitly selects `before-unwind` (the VM default)
or `after-unwind` at the callback boundary. The native runner's
`--first-chance-policy` passes that declared contract to the VM. The native plan
requests `before-unwind` for net8.0 and `after-unwind` for net10.0. It supplies
separate authored expectation files; it never selects behavior by examining
native stdout. The original `expected.txt` and failed CI reports are preserved.
A native target with a different trace still fails exact comparison.

The observed .NET 10 trace contains `cleanup` after the nested subscriber's
notifications and still terminates with the execution-engine failure code
`0x80131506`. The [v10.0.12 managed EH implementation](https://github.com/dotnet/runtime/blob/v10.0.12/src/coreclr/nativeaot/Runtime.Base/src/System/Runtime/ExceptionHandling.cs#L804-L848)
selects a second-pass target at a native transition for CoreCLR. The
[native notification boundary](https://github.com/dotnet/runtime/blob/v10.0.12/src/coreclr/vm/excep.cpp#L10218-L10282)
retains its fatal exception filter. These paths explain callback cleanup before
the native failure boundary; the general original throwing context does not
become a catchable continuation. The retained artifacts do not establish that a
specific installed runtime patch was selected merely because it was installed.

Each failfast qualification now builds one independent runtime probe. It uses
the fixture's exact `Qualification.runtimeconfig.json`, the same dotnet
executable, working directory and environment, and records the process's
`RuntimeInformation.FrameworkDescription`, `Environment.Version`, and runtime
identifier. The report retains the configuration bytes and SHA256, probe source
and assembly hashes, and invocation. This identifies the separately executed
probe's selected runtime without modifying guest stdout or interpreting the SDK
version as a runtime version. The probe runs only for failfast fixtures; the
other native cases retain installed-runtime inventory without an exact-patch
claim.

The unit contract checks simulate process results and do not count as fresh
native qualification. Fresh SDK 8/10 operating-system runs must validate the
declared profile, full trace, abnormal exit and VM state together.
