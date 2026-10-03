/**
 * The differential fixtures of SF-A02-T10 (members and initialization), one module per feature family. The corpus
 * imports this list, so adding a family touches only this file.
 */
import { fixtures as memberInitializers } from './member-initializers.js';
import { fixtures as memberOperators } from './member-operators.js';
import { fixtures as memberInitRequired } from './member-init-required.js';
import { fixtures as memberPrimaryConstructors } from './member-primary-constructors.js';

export const fixtures = [...memberInitializers, ...memberOperators, ...memberInitRequired, ...memberPrimaryConstructors];
