# Closed project assembly references

`@sharpforge/bytecode` exports `PROJECT_REFERENCE_FORMAT`, `projectReferenceLimits`,
`projectAssemblyKey(identity)` and `verifyProjectReferences(references)` for compiler,
PE emission and runtime admission. They describe references to explicitly supplied
SharpForge project artifacts. This structural contract does not resolve files,
download assemblies or grant permission to execute arbitrary native PE inputs.

An optional `image.externalReferences` uses format `SharpForge.ProjectReferences/1`:

| Table | Record |
| --- | --- |
| `assemblies` | `{identity, key, sha256}` |
| `types` | `{assembly, token, name, imageName}` |
| `methods` | `{type, token, name, isStatic, parameters, returnType}` |
| `fields` | `{type, token, name, isStatic, fieldType}` |

Assembly identity contains explicit `name`, four numeric `version` components,
`cultureName`, lowercase `publicKeyToken`, boolean `isRetargetable` and `contentType`
(`default` or `windowsRuntime`). Empty culture and public-key token strings denote
neutral culture and unsigned identity. `projectAssemblyKey` uses the compiler's
full `AssemblyIdentity.getDisplayName()` spelling and escaping; malformed identity
fields throw `TypeError`. Runtime graph admission may impose a narrower executable
identity profile than this structural descriptor.

An assembly's SHA-256 is 64 lowercase hexadecimal characters. Type, method and field
tokens identify nonzero TypeDef, MethodDef and Field rows in that assembly. Types
use exact metadata names and qualify their image name as `[assembly key]type name`.
Methods and fields index their declaring external type. Parameter, return and field
signatures use the compiler's existing image-type strings. External definitions
never become local `image.types` or `image.methods` entries during compilation.

## Bounds and verification

The shared graph admission bounds are 512 assemblies, 32 MiB per assembly and
64 MiB of aggregate supplied PE bytes. Descriptor bounds are 8,192 types, 65,536
methods and 65,536 fields. Each metadata string is at most 4,096 UTF-16 code units
without NUL; method parameter count is at most 1,024. Validation stops at 16 MiB of
aggregate descriptor text, measured as two bytes per UTF-16 code unit, or 100 errors.
The PE graph loader enforces the byte bounds and verifies actual identities,
canonical bytes, hashes and token signatures before execution.

`verifyProjectReferences` returns an array of errors. It is linear in the bounded
descriptor and text sizes, with indexed duplicate detection. `verifyImage` invokes
it when a descriptor is present and checks reachable instruction operands and stack
effects. Well-formed unlinked bytecode is valid emission input. A runtime must resolve
the complete supplied graph before creating an executable method table; bytecode
verification alone does not establish that referenced PE bytes are available.

## Appended opcodes

Existing IDs 0–29 and bytecode format version 2 retain their meaning. IDs 30–35 are
appended. Operand `a` indexes `methods` for calls/allocation and `fields` for access.

| ID | Opcode | Operand `b` | Required stack | Stack change |
| --- | --- | --- | --- | --- |
| 30 | `EXTCALL` | Parameters plus receiver for an instance call | `b` | `1 - b` |
| 31 | `EXTNEWOBJ` | Constructor parameters, excluding receiver | `b` | `1 - b` |
| 32 | `EXTLDFLD` | Zero | 1 | 0 |
| 33 | `EXTSTFLD` | Zero | 2 | -1 |
| 34 | `EXTLDSTATIC` | Zero | 0 | +1 |
| 35 | `EXTSTSTATIC` | Zero | 1 | 0 |

Calls push a value, including the existing null result for a void call. Allocation
targets a nonstatic `.ctor` and returns its new instance. Stores preserve the assigned
value, matching local field/static assignment expressions. Missing descriptors,
incorrect arity, mismatched static/instance fields and stack underflow are rejected.
Ordinary opcodes continue through their existing verifier path without an additional
per-instruction allocation or scan.

Focused tests are in `tests/a23-project-reference-bytecode.test.js`. Execution,
canonical PE emission and CLR comparison belong to the completed project-reference
integration scope; this descriptor module does not claim those results by itself.
