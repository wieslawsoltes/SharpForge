import { fixtures } from '../packages/compiler/test/differential/fixtures/collection-inference.js';
import { registerCompilerReferenceTests } from './support/compiler-pinned-reference.js';

registerCompilerReferenceTests('collection inference', fixtures);
