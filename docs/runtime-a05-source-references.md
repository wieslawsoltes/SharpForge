# Source managed references

The semantic frontend reuses its argument ordering, optional arguments and `params` lowering while
passing real managed pointers for `ref`, `out` and `in`. A location can be a local, a static or instance
field, an array element, a Span element, a ref local, or a ref-returning method/property/indexer. Ref
assignment changes the local's location; ordinary assignment stores through it. Captured variables
continue to use their existing closure fields, whose addresses preserve aliasing during callbacks.

`ADDRESS` retains its original location kinds and adds bit 8 to forward a byref local; bit 4 requests
a readonly view. `LDIND` and `STIND` carry a constant-pool referent type. Their CIL forms are ordinary
`ldobj`/`stobj`, with canonical load/re-emission checking every operand. Source and CIL calls check
ownership, exact referent types, readonly parameters and frame lifetime. A returned local address is
rejected before its frame exits.

The fixture `tests/fixtures/a05-source-refs` covers aliasing, fields, elements, ref returns/indexers,
ref-local reassignment, `in`, `out` and mutations before exceptions. The focused test applies it to the
source VM, reloaded CIL profile and direct CIL. Validation is deferred until the full E01 scope is assembled.
