# Capture setup failures retained with the accepted evidence

The benchmark and metadata records in this directory are successful captures.
The setup failures below are retained separately; none supplied accepted timing
samples, output baselines, metadata pins or a passing test result.

## Paired clean-tree guards

The first paired attempt stopped before warmup when five documentation draft files
reappeared in the candidate worktree. The second attempt stopped at its final
clean-tree guard for the same files. Its measured samples were discarded.
A fresh packages-only detached worktree at the identical compiler revision was
then used. Both accepted paired records verify clean revisions before and after
measurement. No clean-tree guard was removed or weakened.

### Initial guard

```text
node:internal/modules/run_main:107
    triggerUncaughtException(
    ^

AssertionError [ERR_ASSERTION]: candidate worktree must be clean
+ actual - expected

+ '?? tests/fixtures/exported-extension-blocks/README.md\n' +
+   '?? tests/fixtures/exported-extension-blocks/benchmark-after.json\n' +
+   '?? tests/fixtures/exported-extension-blocks/benchmark-before.json\n' +
+   '?? tests/fixtures/exported-extension-blocks/benchmark-pilot-after.json\n' +
+   '?? tests/fixtures/exported-extension-blocks/benchmark-pilot-before.json'
- ''

    at file:///workspace/scratch/1692a10afba9/extension-metadata-paired.mjs:29:10 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: '?? tests/fixtures/exported-extension-blocks/README.md\n' +
    '?? tests/fixtures/exported-extension-blocks/benchmark-after.json\n' +
    '?? tests/fixtures/exported-extension-blocks/benchmark-before.json\n' +
    '?? tests/fixtures/exported-extension-blocks/benchmark-pilot-after.json\n' +
    '?? tests/fixtures/exported-extension-blocks/benchmark-pilot-before.json',
  expected: '',
  operator: 'strictEqual',
  diff: 'simple'
}

Node.js v24.19.0
```

### Final guard

```text
node:internal/modules/run_main:107
    triggerUncaughtException(
    ^

AssertionError [ERR_ASSERTION]: Compiler worktree changed
+ actual - expected

+ '?? tests/fixtures/exported-extension-blocks/README.md\n' +
+   '?? tests/fixtures/exported-extension-blocks/benchmark-after.json\n' +
+   '?? tests/fixtures/exported-extension-blocks/benchmark-before.json\n' +
+   '?? tests/fixtures/exported-extension-blocks/benchmark-pilot-after.json\n' +
+   '?? tests/fixtures/exported-extension-blocks/benchmark-pilot-before.json'
- ''

    at file:///workspace/scratch/1692a10afba9/extension-metadata-paired.mjs:90:10 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: '?? tests/fixtures/exported-extension-blocks/README.md\n' +
    '?? tests/fixtures/exported-extension-blocks/benchmark-after.json\n' +
    '?? tests/fixtures/exported-extension-blocks/benchmark-before.json\n' +
    '?? tests/fixtures/exported-extension-blocks/benchmark-pilot-after.json\n' +
    '?? tests/fixtures/exported-extension-blocks/benchmark-pilot-before.json',
  expected: '',
  operator: 'strictEqual',
  diff: 'simple'
}

Node.js v24.19.0
```

## Metadata probe setup

The ordinary-attribute snapshot probe first omitted the enum TypeRef name resolver
needed to decode `AttributeUsageAttribute`. Supplying names resolved from the
actual metadata fixed the probe; production metadata was unchanged. Native
reflection had already instantiated the fallback attributes in the focused suite.
The pre-optimization nullable control generator first used a shadowed variable in
its loop initializer and stopped before producing a pin. The accepted pin records
its actual clean compiler revision and both reference surfaces.

The machine resource wrapper also queued some captures behind other jobs. No lock
was manually removed and no concurrency or heap limit was overridden.
