# Exception region trees

`buildExceptionRegionTree(code, handlers, options?)` builds an immutable, owned
lexical exception-region tree from CIL bytes and the handler records returned by
`readPE(..., { inspection: true }).methodBody(token)`. It also accepts the named
`filterOffset` writer form. The existing decoder, opcode prefix metadata and
shared scalar clause validation are reused; no compiler or runtime path is
switched to this validator.

The result contains `codeSize`, `roots` (region IDs), `regions` and `clauses`.
Each region has `id`, `kind`, half-open byte offsets `start`/`end`, `parent`
(`null` for roots), `children` IDs and original `clauses` indices. Kinds are
`try`, `catch`, `filter`, `filter-handler`, `finally` and `fault`. Identical try
intervals share one node; handler precedence remains the original clause order.
Each clause has `index`, `flags`, `tryRegion`, `handlerRegion` and nullable
`filterRegion`. IDs index the corresponding result arrays. Input buffers and
objects are never retained, and all returned arrays and records are frozen.

The implementation follows ECMA-335 I.12.4.2.5 and I.12.4.2.7: own regions cannot
overlap; entries must be disjoint, wholly nested inside one non-filter region,
or mutually protect one shared try with catch/filter handlers. Nested clauses
precede their enclosing clauses. All boundaries must be full instruction-group
boundaries, including a prefix sequence's first prefix; a region cannot split
a prefix sequence from its instruction. End-of-code is a valid region end.

`exceptionRegionDiagnosticCatalog` documents stable `CILR0001`–`CILR0030` codes
for invalid input, limits, cancellation, scalar fields, each boundary and each
lexical relationship. Decoder failures carry `CILR0029` and the decoder message.
This validates lexical layout, not the control-flow restrictions of I.12.4.2.8:
stack typing, catch type resolution, required terminators, fall-through,
leave/rethrow/endfilter legality and opcode-specific prefix legality are separate
verifier work. A structurally valid tree is not a claim that a method executes.

Options lower hard bounds: `maxCodeBytes` 16 MiB, `maxInstructions` 1,000,000,
`maxClauses` 100,000, `maxDepth` 1,024. `signal` is checked before decoding and
through projection/tree construction. The reused decoder is bounded; this API
does not yield during synchronous decoding or sorting. Invalid limits fail
before allocation. Instruction boundaries use a one-bit-per-byte bitmap;
decoded instruction records are discarded before tree construction. Construction
costs O(code bytes + clauses log clauses), with O(code bytes + clauses) bounded
temporary storage. There are no pairwise region scans or recursive tree walks.

Offline reference tests reuse the hash-pinned Roslyn AsyncWriter, HoistedLocals
and ClosureMap assemblies and the previously executed filter/fault fixtures.
They do not rebuild native fixtures or claim new platform captures. Broader
compiler-fixture coverage and complete verifier/platform qualification stay open
on #2395.

Reference: [ECMA-335, sixth edition](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
