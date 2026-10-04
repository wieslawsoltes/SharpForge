Pinned native evidence for `StringBuilder.Replace(char,char)` and `Replace(char,char,int,int)`.
Use SDK 10.0.201 and runtime 10.0.5. The program rejects a different runtime and records its own
source SHA-256. Strings are stored as UTF-16 unit arrays, including malformed surrogate sequences.
The fixture records returned identity, exception type/parameter, and before/after text, length,
capacity, maximum capacity and native chunk count. It covers whole/ranged calls, null receivers,
empty ranges, Int32 extremes, equal old/new units, absent matches and cuts through surrogate pairs.

From this directory, in the root-owned serial validation slot:

```sh
dotnet build -c Release --nologo
dotnet bin/Release/net10.0/StringBuilderReplaceChar.dll ../string-builder-replace-char-net10.json
```

Ordinary tests read the frozen JSON; they do not invoke .NET. Native capture and implementation
qualification are separate evidence. Existing rope/capacity differences remain outside this batch.
