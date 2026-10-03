# Unicode text reference

`unicode-dotnet-10.0.5.json` was captured with SDK 10.0.201 and CoreCLR 10.0.5
on macOS Arm64. The snapshot records the OS, invariant sort version, source hash
and compiled extractor hash. Ordinary tests consume this committed snapshot;
they do not build or invoke .NET.

The capture enumerates all 65,536 UTF-16 code units for `Char.IsWhiteSpace`,
`String.IsNullOrWhiteSpace` and `String.Trim`. It also enumerates all 1,114,112
code point values for `String.ToUpperInvariant` and `String.ToLowerInvariant`,
including isolated surrogate units. Changed mappings are retained as pairs;
every omitted code point maps to itself. The extractor rejects any mapping
that changes UTF-16 length. Examples retain UTF-16 integer arrays so JSON
serialization cannot replace isolated surrogates.

The generated runtime tables live in `src/system/unicode-upper-case.js` and
`unicode-lower-case.js`, which ship with the package. Sorted ranges retain every
captured simple mapping, including exceptional Greek mappings. Lookup uses a
binary search, and ASCII-only inputs use equivalent native ASCII casing. No
runtime reference file, native process, locale lookup or Unicode regular
expression is required. Both VM tests compare all captured code points in
bounded batches, independently of the table compression.

The existing default `ToUpper()` and `ToLower()` profile is explicitly invariant.
This batch corrects its simple mappings; it does not claim current-culture
semantics. Runtime culture services are not implemented. Culture-aware default
and explicit overloads remain tracked by
[CultureInfo #2616](https://github.com/wieslawsoltes/SharpForge/issues/2616),
[TextInfo #2620](https://github.com/wieslawsoltes/SharpForge/issues/2620) and
[String culture casing #2623](https://github.com/wieslawsoltes/SharpForge/issues/2623).

The registered `Split(string)` and `Split(string, int)` overloads retain their
input for a null or empty separator, except that count zero returns an empty
array. This matches the captured **string** overload. A null `char[]` separator
selects whitespace on .NET; that distinct overload is recorded for clarity but
is not registered by this batch. Trim operations use the .NET whitespace set:
U+0085 is whitespace, and U+FEFF is not.

Regenerate the native snapshot once in the serial reference queue, then generate
the shipped tables from that snapshot:

```sh
node packages/bcl-core/scripts/capture-unicode-reference.js --dotnet /path/to/pinned/dotnet
node packages/bcl-core/scripts/generate-unicode-casing.js
```

The Node generator performs only deterministic source generation. Changes to the
native capture require re-capturing the snapshot, whose source hash is checked by
the ordinary whitespace tests. Native behavior on other OS/globalization data
versions has not been qualified by this capture.
