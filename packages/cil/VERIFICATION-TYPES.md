# Verification stack merge seam

`verificationType(VerificationKind.Int32)` returns an immutable scalar stack value.
The other scalar kinds are Int64, NativeInt, Float (the CLI `F` stack category),
Null and TypedReference. Object, Boxed, Value, ManagedPointer, ReadonlyPointer and
UninitializedThis require a canonical metadata type object as the second argument.
Its identity is significant; equal display names or tokens from different modules
do not imply equal types. The host must keep those handles immutable. The factory
does not resolve metadata or normalize signatures, enum underlying types or boxed
Nullable types. Callers must supply the normalized verification type.

`mergeVerificationTypes(incoming, stored, relations)` implements the slot-selection
order in ECMA-335 III.1.8.1.3: preserve the stored type if it accepts the incoming
type, otherwise use the incoming type if it accepts the stored type, otherwise
ask for a reference common supertype. Other incompatible pairs throw CILV0002.
Null accepts the other reference type, including boxed values. A writable pointer
merged with a readonly pointer to the same type remains readonly. Int32 and
NativeInt are mutually assignable by I.8.7.3 rule 4, so that pair preserves the
stored operand. Other distinct scalar categories are incompatible. This follows
the stated ECMA rules; it does not claim identical acceptance by native ILVerify.

Metadata-dependent operations use an explicit host adapter:

- `isAssignableTo(source, target)` receives Object/Boxed verification values and
  returns a boolean using CLI verification assignability, including interfaces,
  array covariance and boxed generic constraints.
- `commonSupertype(source, target)` returns an Object/Boxed verification value.
  It must choose the closest valid common supertype. The merge validates that
  both operands are assignable to the result.
- `isPointerElementAssignableTo(sourceType, targetType)` receives canonical
  element handles. This is pointer-element compatibility, not object covariance.

Missing required relations produce CILV0003, rather than assuming that unrelated
types can be merged. Wrong relation result types or incompatible returned common
supertypes produce CILV0006. Relations are trusted synchronous host operations;
they own their metadata traversal limits and cancellation. This keeps CIL
independent of the higher-layer CLR loader and avoids a second metadata type graph.

`mergeVerificationStacks(incoming, stored, {relations, maxStack, signal})` requires
equal-height arrays and returns an owned frozen array. The default and hard maximum
is 65,535 slots; callers can lower it to zero. Limits are checked before allocating
the result (CILV0004). Cancellation is checked before allocation and each slot
(CILV0005). Invalid values/arrays use CILV0001. Runtime work is O(stack height) plus
bounded host relation calls, with one result array and no per-slot allocation on
identity/assignability paths. Scalar values are reused; no session caches grow.

UninitializedThis is an explicit identity-bearing state, compatible only with the
same uninitialized type. Constructor flow, alias initialization and definite
assignment are not implemented by this merge helper. It is not a complete method
verifier: opcode transfer, control-flow propagation, method pointers, CLR metadata
adapters and native ILVerify/platform qualification remain separate work under
#2399 and #52. No compiler or runtime execution path is switched to this API.

The focused table checks all 144 category pairs, pointer mutability, nominal
identity, stack ownership, limits and cancellation. Interface, boxed and array
join cases supply explicit fixture relations; they validate the adapter contract,
not a production type hierarchy implementation. The reference is
[ECMA-335 sixth edition, III.1.8.1.2–III.1.8.1.4](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
Native ILVerify and cross-platform captures have not been run for this seam.
