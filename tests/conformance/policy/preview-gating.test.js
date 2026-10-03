import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { languageInventory, previewAdmission, repository } from '../../../scripts/conformance/release-policy/data.js';

const inventory = await languageInventory();
for (const feature of inventory.rows) {
  const source = await readFile(resolve(repository, feature.probe), 'utf8');
  test(`preview policy ${feature.id}: explicit opt-in admits only experimental testing`, () => {
    for (const version of [undefined, null, 'default', 'latest', 'latestmajor', '14', '14.0', '15', 'Preview ']) {
      assert.equal(previewAdmission(feature, version).accepted, false);
    }
    for (const version of ['preview', 'PREVIEW']) {
      const admission = previewAdmission(feature, version);
      assert.equal(admission.accepted, true);
      assert.equal(admission.qualification, 'unknown');
      assert.equal(admission.specRevision, feature.specRevision);
    }
  });
  test(`preview compiler ${feature.id}: stable/default versions reject the exact inventory probe`, () => {
    for (const langVersion of [undefined, '14', 'latest', 'default']) {
      const result = compile(source, { langVersion, outputKind: 'library' });
      assert.equal(result.success, false, 'Preview proposal silently accepted with ' + langVersion);
      if (feature.supportedProfile) assert(result.diagnostics.some((row) => row.code === 'CS8652'));
    }
  });
  test(`preview compiler ${feature.id}: explicitly opted-in acceptance`, {
    skip: feature.supportedProfile ? false : 'Unsupported compiler proposal; opt-in is permission, not implementation or parity',
  }, () => {
    const result = compile(source, { langVersion: 'preview', outputKind: 'library' });
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    assert.equal(compile(source + '\nclass Malformed { void Broken( }', {
      langVersion: 'preview', outputKind: 'library',
    }).success, false);
  });
}

const examples = [
  {
    id: 'csharp-15-0-collection-expression-arguments',
    source: 'using System; using System.Collections.Generic; List<int> values = [with(capacity:20), 1,2,3];'
      + 'Console.WriteLine(values.Capacity); Console.WriteLine(values.Count);',
    output: '20\n3\n',
  },
  {
    id: 'csharp-15-0-labeled-break-and-continue',
    source: 'using System; int n=0; outer:for(int i=0;i<3;i++){try{for(int j=0;j<4;j++){continue outer;}}'
      + 'finally{n++;}} Console.WriteLine(n);',
    output: '3\n',
  },
];
for (const example of examples) {
  for (const engine of ['source', 'cil']) {
    test(`preview execution ${example.id}: ${engine} ${process.platform}-${process.arch}`, () => {
      assert(inventory.rows.some((row) => row.id === example.id && row.supportedProfile));
      const compiler = engine === 'source' ? compile : compileToIL;
      const result = compiler(example.source, { langVersion: 'preview' });
      assert.equal(result.success, true, JSON.stringify(result.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(result.image) : new CilVirtualMachine(result.assembly);
      try {
        const execution = vm.run();
        assert.equal(execution.state, 'terminated', JSON.stringify(execution.fault));
        assert.equal(execution.output, example.output);
      } finally {
        vm.stop();
      }
    });
  }
}
