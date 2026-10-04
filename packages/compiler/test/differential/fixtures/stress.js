/**
 * The stress family of the differential corpus (SF-A02-T30): realistic programs of 60-200 lines that combine
 * features the way application code does, instead of one feature per fixture. They were written after the
 * feature fixtures, to find what a corpus written next to the features does not cover.
 *
 * Every program is a C# file of its own under `stress/<feature>/<name>.cs`; the fixture id is `<feature>/<name>`.
 * All of them are output fixtures: Roslyn compiles them without errors and their standard output is pinned by
 * `tools/pin.mjs`. See program-files.js for how they are loaded and why they are `referencesOnly`.
 */
import { programFamily } from './program-files.js';

export const fixtures = programFamily('stress');
