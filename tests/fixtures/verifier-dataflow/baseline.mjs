import assert from 'node:assert/strict';
import { verifyCilAssembly } from '@sharpforge/cil';
import { dataflowFixture, nativeCases } from './input.js';
const report = verifyCilAssembly(dataflowFixture(nativeCases[0]), { maxDataflowSteps: 0 });
assert.equal(report.success, false, 'A zero dataflow budget must prevent a successful stack proof');
assert.ok(report.issues.some(issue => issue.code === 'IL_LIMIT'));
