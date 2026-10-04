import assert from 'node:assert/strict';
import * as cil from '@sharpforge/cil';
import { numericFixture, numericCases } from './input.js';

const bytes = numericFixture(numericCases.find(value => value.name === 'Add_0_3'));
assert.equal(cil.verifyCilAssembly(bytes, { methodToken: 0x06000001 }).success, true);
assert.equal(typeof cil.verifyCilMethodTypes, 'function', 'The typed numeric verifier API must exist to reject the height-only gap');
