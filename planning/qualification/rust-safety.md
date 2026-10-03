# Rust memory safety infrastructure

Task: [SF-A29-T35 / #505](https://github.com/wieslawsoltes/SharpForge/issues/505).
This is a partial implementation ahead of Rust product availability. There is no
`rust/gc` or `rust/runtime` product crate at the source base `cdbf8395dc856930397e8caa49de1d510de000f1`.
An absent crate returns `status: unsupported`, `qualified: false`, and no commands.
Neither a successful workflow that records unsupported nor an inventory pass is
Rust qualification. The issue must remain open while the deliverable is incomplete.

## Implemented scope

`.github/workflows/rust-safety.yml` defines one serial matrix over the two actual
crate paths and `inventory`, `address`, `thread`, `miri`, `loom`. It follows the
[serial validation policy](serial-validation.md): this specialized workflow runs
only by manual dispatch in its scheduled slot. Tokens are read-only, action SHAs
reuse the existing Rust workflow, and artifacts are unique per crate, lane and
workflow attempt. A focused Node regression scans the actual product source
without invoking Rust during the
scheduled Node validation. Ordinary core does not execute Node regressions; the
safety matrix also applies this inventory before any native execution.

| Lane | Command policy | Qualification boundary |
| --- | --- | --- |
| Inventory | Lexically inspect every `.rs` under each actual crate, including tests/examples and cfg-disabled source | Documentation gate only, always `qualified: false` |
| AddressSanitizer | Dated nightly, `-Zsanitizer=address`, rebuild std, locked crate tests | Linux x86_64 native library/integration tests |
| ThreadSanitizer | Dated nightly, `-Zsanitizer=thread`, rebuild std, locked crate tests | Same host; Rust documents limitations for fences and assembly synchronization |
| Miri | Install existing dated Miri component, prepare target sysroot, locked crate tests | Linux x86_64 target with default Miri validation/isolation |
| Loom | Workspace's exact toolchain, `--cfg loom`, `--release --test loom` | Requires actual `tests/loom.rs`, declared dependency, registry checksum in Cargo.lock |

All executable lanes first apply the inventory gate and reuse E03's `qualify.py`
workspace/toolchain policy. The workspace must have its committed lockfile, exact
toolchain and explicit deny policy. No toolchain install or Rust process occurs
for an unsupported lane or `--plan`. Runtime commands use argv arrays, separate
target directories, one Cargo build job, one test thread and no shell expansion.
Ambient sanitizer/Miri/loom overrides, encoded Rust flags and compiler wrappers
are removed before applying recorded flags.

Every command has a 1–3600 second timeout (default 900) and 4 MiB output limit;
timeout, cancellation, output overflow, missing executable and nonzero exit fail.
Cancellation kills the command's process group. A zero exit alone does not qualify:
at least one libtest success summary with positive passing-test count is required,
with no ignored, measured or filtered tests. Other harness formats need a reviewed
adapter; they fail closed today. Per-command output, exit status, applied environment
overrides and duration accompany source hashes, exact commit, target and host.

## SAFETY comment contract

All lexical `unsafe {` blocks require a nonempty `SAFETY:` explanation in the nearest
comment, either immediately before the statement on the previous line or inline
before its `unsafe` keyword. A blank line, intervening statement or brace prevents
borrowing the explanation. A trailing comment on an earlier statement cannot
authorize the following statement. Nested blocks each require their own explanation.
This enforces the rule for all current blocks, without a grandfathered baseline.

```rust
// SAFETY: pointer refers to a live, aligned allocation owned by this scope.
let value = unsafe { *pointer };
```

The scanner handles nested block comments, escaped/byte/C/raw strings, character
literals, lifetimes and raw identifiers. It lists unsafe functions, impls, traits,
extern declarations and attributes separately; only unsafe blocks are rejected for
missing explanations. It records file SHA-256, line, column, kind and rationale.
It rejects malformed unterminated comments/strings, source symlinks, nonregular
source files, unreadable traversal, more than 128 comment nesting levels, more than
4096 files/directories, files over 5 MiB or source totals over 32 MiB per crate.
Generated `target/` and `.git/` trees are excluded. The scanner conservatively
inventories lexical macro bodies and does not expand macros, generated Rust,
`include!` outside these directories, or dependency source. Explanations need human
review; text presence is not a proof of memory safety. Rust compilation supplies
the language syntax/type checks when actual crates exist.

## Existing pins and primary references

The safety lanes import `MIRI_TOOLCHAIN = nightly-2025-08-01` directly from E03;
no second version constant, new package dependency or new product crate is added.
The [official distribution manifest](https://static.rust-lang.org/dist/2025-08-01/channel-rust-nightly.toml)
was read on 2026-10-03. It reports Rust `1.90.0-nightly (adcb3d3b4 2025-07-31)` and
available x86_64 Linux rustc/Miri components plus the rust-src component. This
verifies published metadata, not a successful installation or compatibility run.
Future toolchain compatibility failures remain failures and need a reviewed E03
pin update. Loom is supplied only by the real crate's reviewed Cargo.lock; this
change neither adds nor invents a production Loom version.

Command policy follows the official [Rust sanitizer documentation](https://doc.rust-lang.org/unstable-book/compiler-flags/sanitizer.html),
[Miri CI guidance](https://github.com/rust-lang/miri#running-miri-on-ci) and
[Loom upstream instructions](https://github.com/tokio-rs/loom#quickstart).
Sanitizers and passing models expose some defects; none proves soundness or complete
schedule coverage. Doctests, dependencies, non-Linux hosts, Linux ARM64, Windows,
macOS, Wasm and browser engines are not qualified by this workflow.

## Explicitly unimplemented component

The task's requested cargo-fuzz component remains unimplemented. Prior automatic
approval review rejected the shared fuzzing delegation twice. This slice does not
retry that action, install or execute cargo-fuzz, create fuzz harnesses or generators,
or run campaigns. The separate sanitizer/Miri/loom and inventory infrastructure
does not satisfy that blocked portion of #505. No fuzzing pass or coverage is claimed.

## Focused reproduction

Run these only in the shared serial validation slot:

```sh
node scripts/limited.js node --test tests/conformance/rust/safety.test.js
python3 scripts/conformance/rust/safety.py --crate gc --lane inventory --output artifacts/rust-safety/gc-inventory.json
python3 scripts/conformance/rust/safety.py --crate runtime --lane miri --plan --output artifacts/rust-safety/runtime-miri.json
node scripts/planning/check-test-manifests.js
python3 scripts/conformance/supply/workflow-lint.py
```

The Node fixtures use temporary package metadata/source snippets and simulated
process responses, never compile fixture crates or qualify them as product engines.
Positive, negative and boundary fixtures cover comment association, string/comment
false positives, missing crates, cfg-disabled unsafe source, symlinks, byte limits,
toolchain pins, missing Loom models/lock checksums, unsupported hosts, ignored/empty
test output, timeout/cancellation/failure propagation, and ambient flag removal.
Local checks and hosted jobs are pending at initial authoring; no native test,
sanitizer installation, Miri interpretation or Loom execution has been performed.
