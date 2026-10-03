/**
 * The rules of the C# 9 to 12 epics (SF-A02-E09, SF-A02-E10), registered once for both places that compose them.
 *
 *   modernRules    - class mixins of the semantic analysis, in composition order; each runs once the attributes are
 *                    bound (../semantic-analysis.js).
 *   modernBindings - class mixins of the body binder, applied after its construct families (./language-rules.js).
 */
import { CSharp9Rules } from './csharp9.js';
import { CSharp10Binding } from './csharp10.js';

export const modernRules = Object.freeze([CSharp9Rules]);
export const modernBindings = Object.freeze([CSharp10Binding]);
