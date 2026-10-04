# Generic calls that only query sizeof

This [T02.3 / #1356](https://github.com/wieslawsoltes/SharpForge/issues/1356)
increment admits `Size<Cell<int>>()` and static `Cell<T>.ElementSize()` when the
canonical body only returns `sizeof(...)`. It reuses the existing generic method
cache, MethodTable identity and [CLI layout service](runtime-value-layout-sizeof.md).
No struct argument, local, result or box is constructed by the query.

The shared CIL metadata predicate `isSizeOfOnlyMethod(inspector, methodToken)`
recognizes an internal static, default-convention method with no parameters,
locals or exception handlers and an `int` result. Apart from `nop`, its complete
body must be exactly `sizeof; ret`. It inspects at most 4,096 instructions and
rejects extra operations even after `ret`. Invalid or non-MethodDef tokens return
false; malformed metadata encountered by the inspector retains its normal
diagnostic path. This is a shape predicate, not a verifier or a layout promise.

Normal verification still validates the operand, generic indices and arity,
reachable code, stack depth and declaring-type initializers. Runtime admission
still checks ownership, closed generic arguments and every existing constraint.
Aggregate generic arguments use the bounded layout service instead of requiring
value storage. Supported reference-containing sequential layouts can therefore
be measured without enabling their value execution. Unknown external types and
unsupported or invalid layouts retain their existing managed diagnostics.

The shape is checked on cold instantiation only and reused through the existing
code-epoch cache. Restore, code invalidation and inspector replacement retain
their current cache lifecycle. In-place metadata/body edits require explicit
invalidation and reverification; this change does not infer edits from a token.
Frames, snapshots, scalar return storage and method identities gain no new fields.

This does not admit general aggregate generic methods or instance methods.
Methods with parameters, locals, non-int results, branches, calls, or value
storage remain subject to the existing restrictions. Generic aggregate static
initializers are not exempted: when ordinary initialization requires a body the
current profile cannot execute, that failure remains explicit. No initializer
is skipped. Source struct/generic frontend support, full aggregate execution,
explicit-layout reference aliases and native/platform qualification stay open.

`tests/a05-generic-sizeof-calls.test.js` authors real MethodSpec and closed-owner
cases for both native widths, nested/Nullable/reference layouts, constraints,
initialization, malformed operands, shape limits, snapshot replay and cache
invalidation. The retained E01 `Size<Cell<int>>` and `Cell<T>.ElementSize` cases
are ported through the existing current-main fixture builder. No tests, native
tools, builds, checks or benchmarks were run for this leaf; root owns the serial
qualification queue.
