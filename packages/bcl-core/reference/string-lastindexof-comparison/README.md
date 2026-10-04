# String.LastIndexOf comparison reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project StringLastIndexOfComparison.csproj --configuration Release -- ../string-lastindexof-comparison-net10.json
```

The target is LastIndexOf(string, StringComparison), with exact native UTF-16
last-match offsets, source units, identity, faults and parameter names. Successful
rows also retain native IndexOf and Contains results. The corpus includes every
IndexOf input plus overlapping/final matches, empty needles in nonempty strings,
supplementary prefixes, surrogate-half matches and periodic raw-endpoint rejection
before and after valid matches. The source SHA-256 pins the capture bytes.

Receiver null wins first; value null wins over invalid modes. Mode validation
precedes empty or identity shortcuts. An empty value matches at receiver.Length,
including zero for an empty receiver. CurrentCulture is pinned to InvariantCulture.
Native culture outputs remain unchanged; SharpForge explicitly rejects modes 0–3
after receiver/value null checks. Start/count overloads and culture implementation
are outside this fixture's scope.
