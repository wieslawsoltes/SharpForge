# Rectangular arrays and Span source lowering

The source compiler now accepts rectangular rank syntax, nested array initializers,
multiple index arguments, stackalloc length/initializers, Span reads/writes/Slice,
readonly views and empty defaults. Receivers and indices are evaluated once for
compound assignments. Span values cannot box as object; readonly views reject stores.

Stable source opcode additions are LDIND31, STIND32 (control-flow workstream),
NEWRECT33, LDRECT34, STRECT35, RECTADDR36, STACKALLOC37, SPANGET38, SPANSET39,
SPANADDR40, SPANSLICE41, SPANLENGTH42, SPANREADONLY43 and SPANDEFAULT44.
Array shape APIs bind through the array intrinsic profile from T05.

CLI emission uses array TypeSpec constructors/Get/Set/Address, ELEMENT_TYPE_ARRAY
signatures, localloc/sizeof, and real System.Span<T> value-type MemberRefs. Span
indexers use generic !0& signatures; readonly indexers retain the InAttribute
required modifier. The source reload marker preserves operation boundaries, while
canonical re-emission verifies the complete emitted body.

The shared fixture export is tests/a05-memory-source-fixtures.js: each case includes
identical C# source and expected output for the native oracle and all three engines.
Native qualification and all project validation are deferred until the complete E01
scope is assembled. Span runtime region lifetime tests belong to stack-memory.js's
runtime tests; escaped stack pointers are rejected there after frame completion.

When merging main's new modular parser, retain its parser facade and lexer. Apply
legacy-adapter numeric/memory mappings instead of restoring the previous parser.
The new parser already recognizes unsigned shifts and rectangular/stackalloc syntax;
its legacy profile adapters are the remaining boundary.

Main compatibility helper `syntax/src/legacy-adapter/scalars-memory.js` is additive.
In the new LegacyExpressionAdapter.expressionCore, call scalarMemoryExpression(this,
red) before its existing cases and return a defined result. In LegacyTypeAdapter.type,
call scalarMemoryType(this,red,prefix) first. Remove SF1003/SF1004 profile additions in
lexer/numbers.js and SF1003/SF1005 profile additions in lexer/reals.js; retain actual
syntax errors and feature gates. Main's scanner already preserves exact literal.value,
so this adapter copies its BigInt and Decimal96 bits without Number conversion.
