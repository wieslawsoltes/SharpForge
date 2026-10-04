# Portable expression and path contracts

`@sharpforge/project-system` exports `expandExpression`, `evaluateCondition`,
`matchesGlob` and `WorkspacePathIndex`. The expression and condition functions
consume explicit data supplied by the caller. They never discover native files,
read process environment variables, load task assemblies or execute host scripts.

## Expression input

`expandExpression(text, context = {}, { decode = true, metadata = true } = {})`
returns a string. Properties use case-insensitive own keys in `context.properties`.
References are scanned before substitution, so injected `$()` text or condition
operators are returned as data. Percent escapes are decoded after expansion;
`decode: false` preserves them for later item-list processing. `metadata: false`
retains metadata references until an item context is available.

The supported property-function registry includes bounded string operations,
selected String/Math/Version/Convert/Char/Guid/Regex operations, and MSBuild
arithmetic, version, framework, path and escaping intrinsics. Path functions use
`context.resolvePath(value, base?)`; file-above lookup additionally uses
`context.pathIndex` and `context.currentFile`. Environment access reads only
`context.environment`. Time and GUID generation require an explicit `clock` or
`guid` provider. Unknown members and unsupported effects throw diagnostic errors.
The Regex subset rejects constructs whose evaluation cannot be bounded; it is
not a general .NET regular-expression engine. Culture-sensitive operations use
the documented portable implementation, not installed operating-system cultures.

Item references read arrays in `context.items`. Each item has `itemType`,
`identity`, optional `metadata`, `definingProject` and `recursiveDir`. Transforms
retain item metadata; scalar functions include Count and metadata predicates.
Well-known path metadata uses `resolvePath`. Unqualified metadata needs
`currentItem` or `metadataItem`; qualified batching may use `batchItems`.
Missing item or metadata contexts throw `MSB4191`.

Context instances are evaluation-session state: expansion installs `expand` and
`withItem` callbacks when absent and restores temporary item/depth state after
calls. Do not share one mutable context between simultaneous evaluations.
Default expression text and expanded-output budgets are 65,536 UTF-16 code units;
reference nesting is capped at 64. A caller may supply tighter `context.limits`.

## Conditions and diagnostics

`evaluateCondition(text, context)` accepts Boolean values, comparisons,
parentheses, And/Or/not, Exists and HasTrailingSlash. The caller may alternatively
pass `{ context }`. Conditions tokenize before property expansion; short-circuit
branches are parsed but do not invoke inactive functions. Empty conditions are
true. Exists invokes the supplied `context.exists` callback, defaulting to false.

Equality is case-insensitive; relational comparisons require finite numbers or
version operands. Invalid syntax uses `MSB4092`, invalid relational operands
`MSB4086`, and invalid Boolean values `MSB4130`. Expression/member diagnostics
use the existing `MSB4184`/`MSB4185` codes, with source offsets when available.
Condition input is limited to 16,384 code units, 8,192 tokens and 64 nested atoms.
Errors are thrown for the owning project evaluator to attach file information;
this API does not silently turn failed conditions into false.

## Indexed workspace paths

`matchesGlob(path, pattern, { caseSensitive = true } = {})` supports `*`, `?`
and `**`, including zero-directory `**/`. Patterns above 4,096 code units fail.
`WorkspacePathIndex(paths, { caseSensitive = true, maxMatches = 100000 } = {})`
stores logical normalized workspace paths in a directory trie. `exists` performs
direct file lookup or walks the path depth. `glob(pattern, excludes = [])` scans
only the literal-prefix subtree and returns deterministic sorted original path
spellings. Callers pass normalized logical paths to index queries.

`add`, `remove`, `addDirectory` and `removeDirectory` change membership and advance
the explicit `version`. `canonical` returns retained spelling. Directories are
explicit index nodes; removing a file does not implicitly remove its directory.
The `counters` object exposes Exists queries, directory steps, glob queries and
candidate visits for deterministic complexity assertions. The focused contract
fixture exercises 20,000 paths and verifies that a project-prefix glob inspects
only 200 candidates. This is an operation-count bound, not a wall-clock speedup.

The complete ordered property/item/import/SDK evaluator consumes these APIs in a
dependent batch. This prerequisite retains the existing ProjectSystem facade and
does not claim native MSBuild task execution or whole-project parity.
