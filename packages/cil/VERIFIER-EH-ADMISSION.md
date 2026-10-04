# Exception control flow in runtime admission

`verifyCilAssembly` applies the existing lexical exception-region validator to
each admitted method that has EH clauses, before its stack-height traversal.
It checks region geometry and prefix boundaries, EH-sensitive instruction
placement, ordinary branch/switch/fallthrough edges and leave restrictions.
These checks include unreachable instructions within the inspected method;
stack-height propagation remains limited to reachable instructions.

A failure returns an `IL_EH_FLOW` issue with the method identity, source byte
offset when available, and the existing `CILR` or `CILCF` code in `diagnostic`.
The method is not traversed further and no successful stack-capacity proof can
be produced by a failed report. Unexpected internal exceptions still propagate.
The existing standalone APIs and their diagnostic identities are unchanged.

Admission reuses `AssemblyInspector.getMethod`'s `instructions`, `handlers`
and `codeSize`; it does not request PE method bytes or decode instructions again.
Internal decoded-tree/flow seams are not exported through the package entry
point and are not an unchecked public option. The boundary bitmap is shared
between tree construction and transfer validation, then released with the
temporary region/index state. No tree or EH index is allocated for methods
without handlers; those methods retain their existing admission behavior.

The existing region defaults bound code to 16 MiB, instructions to one million,
clauses to 100,000 and lexical depth to 1,024. `maxCodeBytes`, `maxInstructions`,
`maxClauses` and `maxDepth` may lower those limits. EH cancellation/limit errors
are returned through the same issue, retaining their underlying diagnostic.
With I instructions, R regions and E transfer edges, the shared algorithms use
O(I + R log R + E log R) time and O(code bytes / 8 + R) temporary storage beyond
the inspector's existing decoded instructions. No per-edge region scan is added.

This composes existing ECMA-335 lexical rules into the constrained managed
execution profile; it is not a full typed verifier. Catch/filter entry types,
member/type accessibility, cross-assembly binding and typed stack compatibility
remain separate. Filters remain inspection-only even with valid lexical flow.
The previous catch-seed and matching same-catch branch behavior remains covered
by the [entry-state contract](VERIFIER-HANDLER-ENTRY.md). #2407 stays partial.

Eleven authored focused tests and fourteen pinned ILVerify cases are described
in the [reference plan](../../tests/fixtures/a03-eh-admission/README.md).
Local validation, paired existing-path timings and static checks are pending
the serial slot; no passing result is claimed yet.
