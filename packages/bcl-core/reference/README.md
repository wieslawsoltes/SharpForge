# BCL reference snapshot

`dotnet-10.0.5.json` retains unmodified public metadata rows for `System.String`,
`System.Text.StringBuilder`, `System.Array` and `System.Random`. Rows come from
the real reference assemblies through the repository's existing
`scripts/conformance/inventory/native-metadata.js` extractor. No fixture or
handwritten API list substitutes for that extraction.

The pinned toolchain is SDK 10.0.201, CoreCLR 10.0.5 and reference pack 10.0.5.
The snapshot records the source assembly SHA-256, metadata reader source and
compiled assembly SHA-256, and aggregate reference-pack SHA-256. The full
toolchain and platform-specific compiler hashes are in
`planning/qualification/oracle-toolchain.json`.

Regenerate with the installed pinned .NET toolchain and Node 22 or later:

```sh
node packages/bcl-core/scripts/capture-reference.js
node packages/bcl-core/scripts/inventory.js
```

Ordinary documentation generation and checks read the committed snapshot and
need no .NET installation or network access. `npm test` discovers
`tests/a07-20-inventory.test.js`, which rejects documentation drift, including
omitted registered members. The direct check is:

```sh
node packages/bcl-core/scripts/inventory.js --check
```

Coverage means exact metadata signature presence, not behavioral qualification.
Constructors normalize their result to `void`; primitive CLR names normalize to
registry aliases. Generic arity, static/instance, parameter types and result type
must all match. Closed array overloads do not count as open generic methods.
Property/field metadata remains distinct; inherited members are not expanded.
