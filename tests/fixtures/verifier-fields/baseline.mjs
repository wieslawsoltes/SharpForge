import assert from 'node:assert/strict';
import { verifyCilMethodTypes } from '@sharpforge/cil';
import { coreAuthority } from '../a03-type-categories/input.js';
import { fieldFixture, fieldAuthority } from './input.js';
import { fieldCases } from './cases.js';

const input = fieldFixture(fieldCases.find(value => value.name === 'LoadOwner'));
const report = verifyCilMethodTypes(input.bytes, input.method, { coreTypes: fieldAuthority(coreAuthority(), input) });
assert.equal(report.status, 'verified', 'A normal field load with canonical core identity must be typed');
