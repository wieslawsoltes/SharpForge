# Indirect verifier cases

`input.js` independently authors managed assemblies covering all indirect load
and store encodings, signed/unsigned storage, references, invalid addresses,
underflow and unresolved cross-width cases. Unknown results never qualify
execution. Native expectations and differences are declared before capture.

`capture.mjs` reuses the same serial one-method ILVerify runner as the numeric
and initialization fixtures. It pins SDK/runtime/tool/reference hashes, records
the exact fixture and assembly hashes, and saves every raw result before parsing
or asserting. `native.json` will be generated in the scheduled validation slot.
No native or browser run has been performed for this batch yet.

`browser.mjs` checks public verifier results; it does not execute the IL.
Readonly policy behavior is covered directly with branded verification values,
because a typed readonly-prefix producer is a separate pending feature.
