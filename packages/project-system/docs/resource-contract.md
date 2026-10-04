# Portable resource contracts

`@sharpforge/project-system` exposes resource parsing, naming, input discovery and
the built-in `.resources` v2 binary codec. These functions operate on explicit
virtual files. They do not invoke native resource conversion or read disk paths.

## Values and payloads

`parseResx(text, { path = 'Resources.resx', maxLength, readFile, resolvePath })`
returns `{ name, type, value }` entries for strings, Boolean, UTF-16 Char, signed
and unsigned integers through 64 bits, Single, Double and byte/string file
references. Integer XML values are range-checked; 64-bit values use BigInt.
XML whitespace and Unicode string content are retained. Duplicate names,
serialized objects, unsupported value types and DTDs fail explicitly. The default
XML text budget is 2,000,000 code units.

ResXFileRef requires both `resolvePath(value, base)` and `readFile(path)`. Returned
records must provide text or Uint8Array bytes. Metadata-only or lazy records
produce `SFP1501` with `requiredFiles`; unopened files are never converted to empty
content. Missing referenced files produce a diagnostic. The caller controls all
file access and grants.

`writeResources(entries, { maxBytes = 16777216 })` writes actual `.resources` v2
bytes using built-in value codes. Pass well-formed typed entries such as those
returned by parseResx. Object serialization is unsupported. The writer bounds
entry count at 20,000 and name/data payload size, rejects duplicate names, and
orders the table deterministically. `readResources(bytes, { maxBytes })` decodes
built-in records with count/offset/length checks and defensive byte-value copies.
It rejects custom type tables and malformed or truncated input with `SFP1502`.
The reader's byte budget includes the entire input buffer; the writer's budget
applies to the name/data payload, with bounded header/table overhead.

## Naming and required input files

`manifestResourceName(item, context)` returns `{ manifestName, culture }`.
An item has `path`, project-relative `identity` and optional metadata. The context
provides properties, a virtual `files` Map and `resolvePath`. `LogicalName` has
highest precedence, followed by `ManifestResourceName`, dependent source/type
naming, then root namespace plus relative path. `Link`, `DependentUpon`,
`WithCulture` and explicit `Culture` are honored. Culture suffixes are retained
in the manifest name; satellite assembly placement belongs to the build host.

Portable dependent-type discovery recognizes ordinary namespace and type
declarations in text. It does not execute the C# preprocessor or claim the full
native compiler's resource-naming semantics for conditional or exotic syntax.
Explicit naming metadata can select the desired identity for those files.
An existing dependent source with unloaded text requests hydration rather than
falling back to a potentially incorrect name.

`resourceEvaluationInputs(context, { files = context.files })` returns
`{ paths, diagnostics }` across context.items.EmbeddedResource. Its first pass
returns resource and dependent-source paths. Repeat after loading resx to discover
ResXFileRef paths. Diagnostics retain project/context/path provenance. Discovery
does not read or synthesize any content.

`evaluateResources(context)` produces records with path, manifestName, culture,
bytes, entries and itemType. The context additionally provides
`diagnostic(error, node, code)`. Failed resources are omitted from output and
reported to that callback; callers must honor errors before starting a build.
The complete evaluator and assembly-emission host consume this contract in
dependent PRs. This codec/naming batch does not itself emit assemblies or launch
applications. The original full resource scope's CLR evidence is recorded
separately from these focused public API tests.
