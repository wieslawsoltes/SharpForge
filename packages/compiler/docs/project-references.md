# Executable references between project assemblies

The compiler accepts a supplied PE reference with `runtimeProfile: 'sharpforge'`
as an opt-in to the closed SharpForge project execution profile. Normal metadata
binding still decides visibility, overloads, extern aliases, and friend assembly
access. A reference without this marker retains the existing metadata-only
execution boundary.

Using a marked assembly's class or member requires canonical verification of its
real PE method bodies through `@sharpforge/cil`. A profile marker alone does not
authorize arbitrary CLR assemblies. The compiler records the verified assembly's
SHA-256 so the execution loader can require the exact supplied bytes. Compilation
is synchronous and remains on the application's existing compilation worker.
Verification and hashing occur once for each used assembly in a compilation;
there is no process-wide mutable artifact cache.

## Compiler image contract

`image.externalReferences` is optional and has this structured-cloneable shape:

```js
{
  format: 'SharpForge.ProjectReferences/1',
  assemblies: [{
    identity: {
      name: 'Library', version: [1, 0, 0, 0], cultureName: '',
      publicKeyToken: '', isRetargetable: false, contentType: 'default'
    },
    key: 'Library, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null',
    sha256: '<64 lowercase hexadecimal characters>'
  }],
  types: [{
    assembly: 0, token: 0x02000002, name: 'Example.Counter',
    imageName: '[Library, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null]Example.Counter'
  }],
  methods: [{
    type: 0, token: 0x06000001, name: '.ctor', isStatic: false,
    parameters: ['int'], returnType: 'void'
  }],
  fields: [{ type: 0, token: 0x04000001, name: 'Value', isStatic: false, fieldType: 'int' }]
}
```

All indices address these local descriptor arrays. Tokens are the original
TypeDef, MethodDef, and Field tokens in the referenced assembly. The identity key
uses `AssemblyIdentity.getDisplayName()`, including its normal escaping and
optional flags. Consumers resolve `imageName` through the descriptor table; they
must not split bracket-delimited text. Primitive and registered framework type
names retain their existing representation. External class types use their full
assembly-qualified `imageName`, including inside signatures and arrays.

External types and methods never appear in `image.types` or `image.methods`.
Emission writes AssemblyRef, TypeRef, and MemberRef records; the consuming
assembly does not redefine the dependency's types. A library with upstream
references remains a library with a null entry point.

`compileToIL` and Studio's project compiler both retain source class namespaces
and public/internal accessibility in real TypeDef rows. They use the public
`sourceTypeDefinitions(parsedFiles, image)` helper, which consumes already parsed
compilation units and maps exact source declaration identities to image types.
Partial declarations combine visibility. Semantic full names and unambiguous
legacy simple names are matched without splitting generated identifiers; unknown
compiler-generated classes remain internal. The helper returns a null-prototype
record of `{ name, namespace, access }` entries and throws `CilError` for malformed
input, more than 20,000 files, or more than 100,000 source declarations/image types.

The companion `sourceMemberDefinitions(parsedFiles, image)` returns a complete, versioned emission
record for original image slots:

```js
{
  version: 1,
  methods: [{ id, access }],
  fields: [{ type, index, access, isReadOnly }],
  statics: [{ index, access, isReadOnly }]
}
```

Access is `public`, `internal`, `private`, `protected`, `protectedInternal`, or `privateProtected`.
Method IDs, type IDs, and field indices address the original image; dependency definitions are absent.
Source spans distinguish overloads and partial declarations. Auto-property accessors retain their declared
access, generated helpers are internal, and generated storage is private. A synthesized parameterless source
constructor retains its C# public access (protected for an abstract class), including when field initialization
materializes a constructor body. Getter-only auto-property backing
fields and declared readonly fields retain CLI `initonly`. Work is linear in source and image size, bounded
to 200,000 source/image members. The compiler and Studio pass this record to the CIL emitter as
`memberDefinitions`; malformed explicit options report SF3001 through `compileToIL`.

The explicit SharpForge reference profile imports private metadata for accurate CS0122 diagnostics;
the binder still enforces source accessibility. Public metadata imports for arbitrary external assemblies
retain their existing policy. Compiler binding and CIL graph loading share the bounded
`grantsInternalsAccess` rule from the public CIL package, including full public-key friend identities.

## Unresolved reference operations

| Opcode | First operand | Second operand | Stack behavior |
| --- | --- | --- | --- |
| `EXTCALL` (30) | method descriptor index | receiver plus parameter count | Consumes arguments; produces result or null for void |
| `EXTNEWOBJ` (31) | actual `.ctor` descriptor index | parameter count | Consumes arguments; constructs and produces one object |
| `EXTLDFLD` (32) | instance field descriptor index | zero | Consumes receiver; produces value |
| `EXTSTFLD` (33) | instance field descriptor index | zero | Consumes receiver and value; produces assigned value |
| `EXTLDSTATIC` (34) | static field descriptor index | zero | Produces value |
| `EXTSTSTATIC` (35) | static field descriptor index | zero | Consumes and produces assigned value |

`EXTNEWOBJ` denotes the public metadata constructor, including initialization. It
does not reference the emitter's private allocation constructor. A source VM
loader may resolve it through a verified factory routine that performs canonical
allocation, initialization, and constructor-body execution. Runtime dispatch
must not receive unresolved reference operations.

## Bounds and unsupported constructs

The shared bytecode limits allow 512 supplied assemblies, 64 MiB aggregate PE
bytes, 32 MiB per PE, 8,192 referenced types, 65,536 referenced methods, and
65,536 referenced fields. This compiler additionally bounds metadata identity
strings at 4,096 UTF-16 units and method parameter lists at 1,024 entries.

The initial executable boundary covers nongeneric class definitions, ordinary
static and instance methods, constructors, properties, indexers, and fields.
Generic, virtual, abstract, extern, and by-reference methods and volatile fields
remain explicit `SF2200` diagnostics. External structs, interfaces, and arbitrary
native assemblies retain their existing unsupported execution path. Compiler
semantic accessibility diagnostics remain errors and are never suppressed to
make a reference executable.

`loadAssembly(bytes)` still represents a single, canonical, unlinked module. The
execution graph loader separately receives startup assembly bytes and a bounded
explicit dependency list; it verifies identities and hashes before connecting
references, then preserves each module's state and source maps.
