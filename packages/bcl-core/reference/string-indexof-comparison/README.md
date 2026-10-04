# String.IndexOf comparison reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project StringIndexOfComparison.csproj --configuration Release -- ../string-indexof-comparison-net10.json
```

The capture calls only IndexOf(string, StringComparison), recording exact native
UTF-16 match offsets, source units, identity, faults and parameter names. It also
records native Contains on successful calls to retain the first-match/result
relationship. The corpus includes all inputs from the Contains reference and
additional multiple/overlapping matches, supplementary prefixes, surrogate-half
matches and embedded NUL offsets. The source SHA-256 pins these capture bytes.

Receiver null wins first; value null wins over invalid or unsupported modes.
Mode validation precedes empty, identity and length shortcuts. CurrentCulture is
pinned to InvariantCulture. Native culture outputs remain unchanged; SharpForge
explicitly rejects modes 0–3 after the receiver/value null checks. Culture support,
start/count overloads and LastIndexOf are outside this fixture's scope.
