/**
 * Differential fixtures for SF-A02-E09 and SF-A02-E10 (C# 9.0 to 12 semantics), one module per task. New modules of
 * these epics are registered here, so the corpus has a single registration for both.
 */
import { fixtures as targetTyping } from './target-typing.js';
import { fixtures as topLevel } from './top-level.js';
import { fixtures as globalUsings } from './global-usings.js';
import { fixtures as csharp9Rules } from './csharp9-rules.js';
import { fixtures as csharp10Rules } from './csharp10-rules.js';
import { fixtures as csharp11Rules } from './csharp11-rules.js';
import { fixtures as csharp12Rules } from './csharp12-rules.js';

export const fixtures = [...targetTyping, ...topLevel, ...globalUsings, ...csharp9Rules, ...csharp10Rules, ...csharp11Rules, ...csharp12Rules];
