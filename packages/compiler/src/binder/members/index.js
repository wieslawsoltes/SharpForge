/**
 * The member binders of SF-A02-T10 as body-binder mixins, in composition order. They refine the creation, name and
 * conversion families, so the body binder composes them after those.
 */
import { InitializerBinding } from './initializers.js';
import { PrimaryConstructorBinding } from './primary-constructors.js';

export const memberBindings = Object.freeze([InitializerBinding, PrimaryConstructorBinding]);
