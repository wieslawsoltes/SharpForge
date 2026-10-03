/**
 * The analysis phases of the C# 9 to 12 epics (SF-A02-E09, SF-A02-E10), in composition order. Each is a class mixin of
 * the semantic analysis that runs once the attributes are bound; a new one is registered here, so
 * ../semantic-analysis.js lists these epics once.
 */
import { CSharp9Rules } from './csharp9.js';

export const modernRules = Object.freeze([CSharp9Rules]);
