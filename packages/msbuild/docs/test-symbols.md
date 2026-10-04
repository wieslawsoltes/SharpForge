# Portable test declaration contract

`@sharpforge/msbuild` exports `discoverTestSymbols` and `testSymbolsFromTrees`.
They read compiler-owned lossless declarations without executing user source or
loading a test framework. Framework discovery and managed provider execution are
separate consumers of these records.

`await discoverTestSymbols(input, options)` accepts source text, an array of
`{uri, text}` records, `{trees: SyntaxTree[]}`, or an already prepared
`{types, methods, ...}` result. Source input lazy-loads `@sharpforge/syntax`;
existing trees are inspected directly and prepared records pass through unchanged.
`testSymbolsFromTrees(trees, options)` is the synchronous frontend for owned trees.

Both return `{types, methods, diagnostics, attributeSpans, identifierReferences,
sources}`. The arrays/maps describe one in-process declaration graph; methods
reference their declaring type and nested types their parent. This is preparation
data, not a serialized transport protocol. Callers retain ownership of supplied
trees and prepared records; a passthrough result is not copied or frozen.

Type records retain full names, source spans, modifiers, base types, constructors,
methods, data-provider descriptors and constant rows. Method records retain full
names, modifiers, return/parameter types, normalized attributes and declaration
spans. Source lines/columns are one-based UTF-16 positions, with offsets retained
for exact attribute/provider projection. Syntax errors remain diagnostics.

Literal attribute values, unary scalar operations, arrays, collections, typeof,
nameof and casts are represented without executing code. Other expressions remain
`{kind: 'unresolved', expression}`. Constant array/return/yield data rows are retained;
computed providers are described for a later explicit managed-runtime consumer.
Attribute names retain qualified spelling after removing global::; named and
positional values remain separate. Optional `resolveAttributeType(attribute)` and
`resolveConstant(node)` hooks supply semantic facts. The latter returns
`{hasValue: true, value}` when resolved; it never implicitly evaluates a callback
from user source.

Options include `languageVersion` (default 14), `preprocessorSymbols`, `signal`
and `maxMethods` (default 100000). Source collections are capped at 10000 entries,
each text at 4 million characters, and attribute-expression depth at 32.
Cancellation is checked during parsing and traversal. Framework matching, row
expansion, inherited fixture policies, case IDs and execution belong to dependent
adapters; unsupported source expressions remain explicit descriptors.

This batch declares the existing internal syntax package dependency. The protected
root lockfile's matching metadata is coordinated with the final repository
integration patch; it is not modified by this publication.
