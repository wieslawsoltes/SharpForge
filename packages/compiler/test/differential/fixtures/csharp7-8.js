/**
 * The differential fixtures of the C# 7 and C# 8 semantics epics (SF-A02-E07, SF-A02-E08): one module per task,
 * registered here so that the corpus lists the two epics once.
 */
import { fixtures as csharp8Statements } from './csharp8-statements.js';
import { fixtures as expressionVariables } from './expression-variables.js';

export const fixtures = [...csharp8Statements, ...expressionVariables];
