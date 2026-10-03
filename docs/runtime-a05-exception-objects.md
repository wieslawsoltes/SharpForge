# Managed exception objects (T04.5)

Exceptions have inherited Message, InnerException, HResult, Data and _stackTrace layout fields. Additional user fields follow the inherited fields. Data uses an identity-stable managed IDictionary with traced key/value slots. Every mutation uses the heap's COW write boundary. InnerException and captured EDI objects remain ordinary managed roots; trace records contain plain method names, tokens and offsets, never host Error stacks or live frame references.

A new throw records the current managed stack top-down. `throw;` reuses the original fault and trace; `throw ex;` creates a new dispatch and replaces the saved trace. ExceptionDispatchInfo stores a separate copy of the captured logical trace, so a later independent throw of the same exception cannot corrupt it. Throwing through EDI appends the current managed dispatch frames with a previous-throw separator.

AggregateException stores a read-only managed list of inner exceptions and flattens nested aggregates breadth-first without JavaScript recursion. Array and read-only-list inputs are supported. The general guest IEnumerable constructor contract still requires executing its iterator; that adapter is recorded as a boundary until the call continuation supports it.

The native fixture exercises preserve/reset/EDI behavior, InnerException identity, mutable HResult, Data and nested aggregate ordering. Focused tests additionally cover roots, COW snapshot isolation, null EDI input and dictionary key failures. Full native/browser/source qualification is deferred until all E01 work is assembled; no test result is claimed here.

Behavior follows [CoreLib Exception](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Private.CoreLib/src/System/Exception.cs) and [ExceptionDispatchInfo](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Private.CoreLib/src/System/Runtime/ExceptionServices/ExceptionDispatchInfo.cs).
