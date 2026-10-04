# Indirect verifier cases

`input.js` independently authors managed assemblies covering all indirect load
and store encodings, signed/unsigned storage, references, invalid addresses,
underflow and unresolved cross-width cases. Unknown results never qualify
execution. Native expectations and differences are declared before capture.

`capture.mjs` reuses the same serial one-method ILVerify runner as the numeric
and initialization fixtures. It pins SDK/runtime/tool/reference hashes, records
the exact fixture and assembly hashes, and saves every raw result before parsing
or asserting. `native.json` retains ILVerify 10.0.5 observations for all 56 cases on .NET 10.0.5 / SDK 10.0.201. The seven predeclared policy differences remain explicit (two I4/native assignments and five unknown storage shapes).

`browser.mjs` checks public verifier results; it does not execute the IL.
Readonly policy behavior is covered directly with branded verification values,
because a typed readonly-prefix producer is a separate pending feature.


Qualification at `7c02d3f67650428fea2564d84cc4bd8bbd7797d6` completed in one serial Node 24.21.0 limiter slot: 55/55 focused tests; 59 verifier checks each in Chromium 153, Firefox 155 and WebKit 26.6; static/manifests passed with zero errors and no owned structure findings. These browser checks verify the API, not execution of the IL.

`qualification/` retains every command, source/input hash, browser observation and all 120 fixed samples (36 baseline + 36 candidate numeric controls and 48 new memory samples). Root explicitly accepts the existing Add median +0.151667 µs / +6.9458%, p95 +0.391042 µs / +16.3716%, and Diamond p95 +0.136250 µs / +5.2624% per verification for the registered memory contribution. No causal, noise, speedup, allocation or peak-memory claim; sampled heap deltas are not allocation counts. Other platforms and runtime execution remain unqualified.
