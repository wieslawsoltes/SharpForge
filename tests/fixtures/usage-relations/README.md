# Bounded instruction usage relations

Implementation-ready first #2573 batch: actual `uses`, `used-by`, `instantiated-by`
and `assigned-by` occurrence indexes. The full leaf remains open: override and
interface implementation mapping require a real canonical host slot contract,
not name guesses. The CIL package does not import CLR.

`input.mjs` is independently authored ordinary CLI metadata with direct/MemberRef
method and field aliases, a constructor, repeated call sites, field stores, type
handles, an array and an unresolved external call. Eight focused groups are
prepared for exact expected sets, ordering/pagination, independent owned output,
aggregate limits, raw-token extent rejection, malformed IL, cancellation, explicit
native-body incompleteness and legacy callGraph/cache/error compatibility.

`Program.cs` and `capture.mjs` prepare an independent native reference using pinned
Roslyn/CoreCLR. Reflection's `GetMethodBody` bytes, `System.Reflection.Emit.OpCodes`
and `Module.ResolveMember` report operand sites and local canonical identities for
three methods containing constructor use, calls and field reads/writes. Capture
has not run; `native.json` will be generated only in the granted serial slot.
Offline tests never compile or write files. Existing CIL decoder and member/type
resolver seams are reused, including explicit unknown results for unsupported
constructed/generic/external references. Literals are not symbol dependencies;
array allocation is not element-type construction; indirect field writes are not
guessed from address-taking.

No install, tests, native capture, benchmark, browser or static checks have run
for this batch. Planned qualification is one scheduled serial native capture,
new/affected tests, fixed before/after legacy callGraph control plus bounded new
analysis/query measurements, one focused browser round and static/structure.
Logical occurrence/index counts are not actual retained/peak process heap bounds.
