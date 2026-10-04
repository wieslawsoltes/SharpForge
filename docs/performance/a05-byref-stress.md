# A05 instruction-boundary byref GC stress

`VirtualMachine` and `CilVirtualMachine` accept `gcStress: 'instruction'` to collect
the managed heap immediately before each guest instruction. It is a diagnostic
mode, disabled by omission or `false`; other values fail with `GC_STRESS_MODE`.
Source fusion and CIL numeric blocks must remain disabled in this mode. A CIL
manual `step()` also collects; it retains the existing manual-step instruction
counter behavior. Bounded array continuation units collect at their admitted work
boundaries. Observer pauses and stopped machines do not execute or collect.

Collection runs before advancing the instruction pointer, while the complete
frame and operand stack are still available to the normal root provider. No
alternate collector or test-only roots are installed in positive runs. The
disabled mode adds one option branch to the ordinary dispatch path; performance
qualification must use the integrated revision containing that branch.

`tests/byref-gc-stress.test.js` implements the SF-A05-T03.7 / #1370 corpus. The
fixed xorshift32 seed is `0x53464237`. Its 1,000 independent CLI assemblies contain
334 object-field, 333 array-element and 333 boxed-value owner programs. Executable
constants, one-to-five nested ref calls, field padding and first/last array
indices vary. Every assembly hash must be distinct. A static ref-return factory
removes ordinary ownership; the returned interior passes through the evaluation
stack, ref arguments and a ref local. Nested value-type field paths carry both
`int&` and `Node&` writes. New nodes are reachable only through the nested owner
after the write, and every nested caller reads the stored reference again.

The runner advances actual one-instruction slices and observes canonical storage
between slices. It never calls `collect()` itself. Each positive guest must
terminate with its computed checksum and have exactly one observed heap
collection per executed instruction. Both generic and precise root providers
run, with native-width *configuration* alternating between 32 and 64 bits. Three
boundary specimens additionally prove sole ownership in each storage category.
For each owner kind, a negative-control VM uses the existing iterable-root seam
to omit only byref owners lacking an ordinary frame reference; the same guest
must then fault with `InvalidReferenceException`.

Thirty-two field/array source counterparts run through the source image, reloaded
source image and compiler-produced CIL (96 further executions). The source
bytecode has no unbox-address instruction, so box-interior creation is explicitly
covered by independent direct CIL. These Node tests do not establish native,
Rust, Wasm or browser qualification.

Run serially from the repository root after the integration commit is clean:

```sh
SHARPFORGE_BYREF_STRESS_REPORT=artifacts/a05-byref-gc-stress.json \
  node scripts/limited.js node --test tests/byref-gc-stress.test.js
```

Create `artifacts` first if needed. The optional report uses exclusive creation
and never overwrites existing evidence. It records the Git commit, tracked-dirty
flag, Node/platform/architecture, generator file hashes, ordered corpus hash,
counts, instruction and collection totals, per-specimen hashes and observed
storage coverage. Without the environment variable the test writes no files and
prints a compact TAP diagnostic. A report from a dirty tree is labeled as such;
it must not be presented as immutable acceptance evidence.
