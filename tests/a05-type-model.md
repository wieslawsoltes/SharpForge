# Runtime method tables and assignability

Every managed heap record has a frozen `methodTable` header. Its registry owns
canonical type identities, including distinct namespace-qualified names, array
ranks and closed generic instantiations. `record.type` remains a display and
legacy platform alias; casts, layouts and virtual dispatch use the header.
Synthetic tokens are negative and assembly metadata tokens retain their CLI
values. TypeRef and TypeSpec tokens resolve to the canonical table, so aliases
do not create another runtime identity.

Tables contain the base, interface implementation maps, virtual declaration
targets, element type, generic definition and arguments, flags, field layout,
instance size and GC reference bitmap. Sizes describe the JavaScript VM's
existing allocation model: 32 bytes plus eight bytes per object slot, or a
24-byte string prefix. Array GC bitmaps describe the repeating element slot.
Dynamic platform records can carry additional slots; the collector continues
tracing their actual payloads. These are VM layouts, not native CLR byte offsets.

`CastCache.isAssignableFrom(target, source)` follows reflection's assignment
direction. Reference variance applies only to interface and delegate generic
parameters. Value arguments remain invariant; Nullable<T> accepts T, while a
boxed enum retains its enum identity rather than becoming its underlying
integer. Arrays implement CLR covariance and the reduced integral element rules:
signed/unsigned pairs and enums with matching underlying storage can share an
array view, while Boolean/Byte and Char/UInt16 do not. Covariant reference stores
still check the actual array element table.

The expectations in `a05-type-fixtures.js` cover classes, inherited interfaces,
namespace collisions, generic variance/invariance, open definitions, Nullable,
enums, jagged and multidimensional arrays, reduced integral arrays and rank-one
non-vector arrays. `node tests/a05-type-dotnet.mjs` builds the generated C# source
against .NET 10 and compares every row with live `Type.IsAssignableFrom` results
and the shared cast implementation. `a05-type-tables.test.js` additionally
executes a genuine CIL fixture with two namespace-qualified `Widget` types and
distinct virtual methods. The source engine uses the same registry and heap;
its current compiler still rejects same-named namespace declarations (SF2011)
and user generic declarations, so those compilation paths are covered through
CIL metadata and direct source-image tables. Native pointers are not managed
objects and do not participate in reference casts. Cross-assembly loading and
native CLR layout/ABI compatibility remain outside the executable profile.

The reference contract is [.NET Type.IsAssignableFrom](https://learn.microsoft.com/en-us/dotnet/api/system.type.isassignablefrom?view=net-10.0).
Array rank and vector-interface behavior follow the pinned [.NET 10 MethodTable
implementation](https://github.com/dotnet/runtime/blob/v10.0.0/src/coreclr/vm/methodtable.cpp)
(`ArrayIsInstanceOf`, `ArraySupportsBizarreInterface`); integral element reduction
follows [.NET 10 TypeDesc::CanCastParam](https://github.com/dotnet/runtime/blob/v10.0.0/src/coreclr/vm/typedesc.cpp).
