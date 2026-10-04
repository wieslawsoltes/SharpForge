import { fixtures } from '../packages/compiler/test/differential/fixtures/pointer-inference.js';
import { registerCompilerReferenceTests } from './support/compiler-pinned-reference.js';

registerCompilerReferenceTests('pointer inference', fixtures);
