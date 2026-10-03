# Tail transfers (T02.7)

Managed `tail. call`, `tail. callvirt` and `tail. calli` request frame replacement after target resolution and argument validation. Calls carrying references into the caller's locals, stackalloc regions or spans fall back to an ordinary call so those locations remain valid. Active initializer/filter/unwind state also prevents replacement. A prepared replacement is admitted to the byte budget before its caller is removed; a rejected oversized callee leaves the caller available for fault inspection.

`jmp` requires an empty evaluation stack and a matching managed signature. It forwards the current argument array into a verified target and replaces the frame. Unsafe lifetime transfers and unavailable external jump targets produce structured managed failures.

The focused IL tests include exactly 1,000,000 tail-recursive calls with at most two frames, caller-local byref fallback, signature/stack rejection and atomic budget overflow. Native qualification of generated IL and performance measurement are deferred with the rest of E01; no passing result is claimed.
