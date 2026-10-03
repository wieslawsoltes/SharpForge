/**
 * Differential fixtures for SF-A02-E04 (C# 1.0 and 2.0 semantics), one module per task. New modules of this epic are
 * registered here, so the corpus has a single registration for the whole epic.
 */
import { fixtures as jumps } from './jumps.js';
import { fixtures as exceptionHandling } from './exception-handling.js';
import { fixtures as statementLowering } from './statement-lowering.js';

export const fixtures = [...jumps, ...exceptionHandling, ...statementLowering];
