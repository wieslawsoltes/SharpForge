# StringReader buffer reference

Run serially from this directory using SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project ReaderBuffer.csproj --configuration Release -- ../string-reader-buffer-net10.json
```

The unchanged 56-row capture covers TextReader base calls to StringReader Read
and ReadBlock with UTF-16 buffer slices. It retains integer code units, including
isolated and split surrogates, and records counts, resulting storage, subsequent
Peek results, validation precedence and exact exception types. Source bytes and
toolchain versions are pinned in the output. Tests execute identical inputs as
source bytecode and independently assembled CIL. Separate bound and legacy source
tests cover character-array calls on both VMs. Never replace native rows with runtime-produced expectations.
