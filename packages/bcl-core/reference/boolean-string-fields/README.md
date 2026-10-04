# Boolean readonly string-field reference

This fixture records `System.Boolean.TrueString` and `FalseString` from SDK
10.0.201 and CoreCLR 10.0.5. It uses ordinary public field reads and reflection;
it neither changes private fields nor simulates native execution.

The output contains all public declared Boolean fields, their exact declaring
type and field type, and their public/static/init-only/non-literal metadata.
Property and getter lookups separately establish that these members are fields.
Value rows include UTF-16 code units, lengths, repeated reads, reflection reads,
matching literals, copied strings, interning, and reference identity after a
full collection. Culture rows record the unchanged fields under invariant,
English, Turkish and Azeri cultures. The collection observations retain the
original string locally; they establish identity across collection, without
isolating which native root kept the string alive.

The source, project and runtime assembly hashes are recorded with the runtime
assembly identity and host description. The SDK label is the pinned build
requirement; the serial capture log must independently record the SDK used.

Run from this directory with the pinned SDK:

```sh
dotnet build BooleanStringFieldsReference.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/BooleanStringFieldsReference.dll ../boolean-string-fields-net10.json
```

The coordinating agent executes this fixture in the shared serial validation
lane. Freeze `Program.cs` and the project before capture. Ordinary tests read
the resulting committed JSON and never invoke .NET.

## Captured reference

The [committed capture](../boolean-string-fields-net10.json) was produced with
SDK 10.0.201 and CoreCLR 10.0.5 on Ubuntu 24.04.3 LTS, x64. The build completed
with zero warnings and zero errors. It contains two field metadata records, two
value rows, four culture rows and four keyword/distinctness observations.

Both fields are public, static, init-only and non-literal, with declared type
`System.String`. Each is reference-equal to its matching literal and interned
string. A copied string has equal text and a distinct reference; interning the
copy returns the field's reference. The recorded values and references remain
unchanged across the four cultures.

| Artifact | SHA-256 |
| --- | --- |
| Program.cs | `8cc63fdef39f630d63cb50718c68de43b759004c059ceb2dc08503d0dfb14dc0` |
| BooleanStringFieldsReference.csproj | `772eff4e2c0f9b0327bb80d130bf73799ec1f47fb8ff8a7572162535705973d4` |
| boolean-string-fields-net10.json | `5155917b117ab8906d00c4863efa0220cd9b0140bd847037418585701dd13d69` |

The serial log is retained at
`artifacts/project9-resume/boolean-string-fields-native.log` in the qualification
worktree. This capture establishes native observations; SharpForge execution
results are recorded separately by the coordinating agent.

The native implementation is pinned at:

https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Boolean.cs

Managed test coverage additionally targets source, canonical reloaded CIL and
independently authored CIL field loads; readonly diagnostics; weak interning;
GC roots; snapshots; separate VMs; allocation-observer reentry, failure and stop.
Those injected-callback policies are separate from the native observations.

This prerequisite registers two genuine fields and consumes no method IDs.
[SF-A07-T21 / #783](https://github.com/wieslawsoltes/SharpForge/issues/783) remains
open for its Object/ValueType behavior and remaining Boolean APIs. This fixture
does not qualify Parse, TryParse, ToString, CompareTo or broader Boolean support.
