/**
 * The breaking-change regression corpus as differential fixtures (SF-A02-T12.1): every change of
 * ../../conformance/breaking-changes/index.js at its old and at its new language version, pinned against Roslyn.
 */
import { feature } from './kit.js';
import { breakingChangeFixtures } from '../../conformance/breaking-changes/index.js';

export const fixtures = feature('breaking-changes', breakingChangeFixtures());
