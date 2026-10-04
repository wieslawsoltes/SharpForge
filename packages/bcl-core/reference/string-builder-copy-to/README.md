# StringBuilder CopyTo reference

SDK 10.0.201/runtime 10.0.5 capture 50 bounded cases for
`CopyTo(int, char[], int, int)`. The corpus retains exact destination UTF-16 units,
unchanged builder contents, native fault types and parameter names. It covers
cross-segment ranges, NUL/surrogates, count zero, null receiver/destination,
negative/Int32-limit arguments and competing invalid-argument precedence.
The corpus includes unchecked Int32 subtraction and a negative count paired with
a destination start just past the array, preserving the native slice-start fault.
Positive destination allocations contain at most nine characters; Int32.MaxValue
counts occur only with bounded destinations that must reject the copy.

```sh
dotnet build BuilderCopyTo.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/BuilderCopyTo.dll ../string-builder-copy-to-net10.json
```

Root executes this immutable capture in the serial queue. Managed GC/write
observer controls are separate from the native single-threaded behavior.
