# Framework contract ID regression

The WinUI callback qualification found an obsolete assertion that every framework
contract ID equals its position in the exported contract list. The framework
contribution manifest preserves dense released IDs 0–1743 and assigns new area
contributions independent reserved blocks. A07 starts at 524288, so its first
contract correctly has a different ID from its list position. Current main still
contains the old assertion; this follow-up changes no registration or runtime code.

The extracted `tests/winui-contract-ids.test.js` retains uniqueness, the dense
legacy constraint and inherited member checks. It additionally checks reservation
membership, the committed member identity lock, builtin dispatch by ID and exact
member lookup identity for every registered contract. Reserved IDs must remain
stable even when later modules add contracts.

The integration owner passed all 144 tests in the following batch at `d8cab8f6`
in the sole serial validation slot (Node 24.21.0; 512MB heap):

```sh
node scripts/limited.js node --test tests/winui-contract-ids.test.js tests/winui-runtime.test.js tests/concurrency.test.js
```
