import assert from 'node:assert/strict';
import { verifyCilMethodTypes } from '@sharpforge/cil';
import { initializationFixture, initializationCases } from './input.js';
const fixture = initializationCases.find(value => value.name === 'StoredLoad');
assert.equal(verifyCilMethodTypes(initializationFixture(fixture), 0x06000001,
  { localInitialization: 'definite-assignment' }).status, 'verified',
'Definite-assignment policy must accept a proven store-before-read without InitLocals');
