/**
 * Differential fixtures for SF-A02-E09 and SF-A02-E10 (C# 9.0 to 12 semantics), one module per task. New modules of
 * these epics are registered here, so the corpus has a single registration for both.
 */
import { fixtures as targetTyping } from './target-typing.js';

export const fixtures = [...targetTyping];
