/**
 * Regression programs reduced from the stress family (SF-A02-T30): every defect a stress program exposed has the
 * smallest program that shows it under `reduced/<feature>/<name>.cs`, pinned from Roslyn like every other fixture
 * (`tools/pin.mjs`) and run on real .NET (see program-files.js). The features are named after what was wrong:
 * `reduced-calls` (arguments, overloads), `reduced-interfaces`, `reduced-tuples`, ...
 */
import { programFamily } from './program-files.js';

export const fixtures = programFamily('reduced');
