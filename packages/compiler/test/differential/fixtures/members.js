/**
 * The differential fixtures of SF-A02-T10 (members and initialization), one module per feature family. The corpus
 * imports this list, so adding a family touches only this file.
 */
import { fixtures as memberInitializers } from './member-initializers.js';

export const fixtures = [...memberInitializers];
