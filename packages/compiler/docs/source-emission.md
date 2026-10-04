# Source metadata in emitted assemblies

`compileToIL` reuses its parsed compilation units to preserve source names,
namespaces and declared access in real TypeDef, MethodDef, Field and Property
metadata. This applies to normal library, executable and netmodule emission.
It does not concatenate project sources or redefine imported dependency types.

The public `sourceTypeDefinitions(parsedFiles, image)` helper maps exact source
class identities to `{ name, namespace, access }` records. Partial declarations
combine public/internal visibility. Semantic full names and unambiguous legacy
simple names are matched explicitly; generated names are opaque and internal.
Malformed inputs, more than 20,000 parsed files or more than 100,000 source
classes/image types throw `CilError`.

`sourceMemberDefinitions(parsedFiles, image)` produces a complete version-1
record for the original image slots:

```js
{
  version: 1,
  methods: [{ id, access }],
  fields: [{ type, index, access, isReadOnly }],
  statics: [{ index, access, isReadOnly }]
}
```

Access is `public`, `internal`, `private`, `protected`, `protectedInternal` or
`privateProtected`. Source spans disambiguate overloads and partial declarations.
Auto-property accessors preserve their access; generated backing storage is
private, and declared readonly/getter-only backing fields retain `initonly`.
Generated helpers remain internal. An implicit parameterless constructor has
public access, or protected access for an abstract class, including when field
initialization creates a constructor body.

Both helpers perform indexed work linear in source/image size. Member projection
is bounded to 200,000 aggregate source/image members. The CIL emission contract
additionally limits each explicit member table to 100,000 records. Invalid
explicit profiles are rejected; `compileToIL` reports emission errors as SF3001.

Advanced callers may supply explicit `typeDefinitions` or `memberDefinitions`
options. Omitting an option computes its source projection; the CIL emitter
validates and records that projection for canonical re-emission. Named semantic
properties retain their real metadata associations and individual accessor flags.
The existing indexer canonical-profile boundary remains explicit.

The focused source-model test preserves the original accepted source cases for
all six access values, readonly private backing fields, constructor access,
partial/overloaded methods, namespace identity and malformed/budget rejection.
Cross-project binding and runtime qualification use these same emitted metadata
contracts in the dependent project-reference scope.
