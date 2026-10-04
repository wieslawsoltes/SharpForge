import {registerBclModules} from '@sharpforge/bcl-core';
import {registerBclCollectionExtensions} from '../bcl-contracts.js';
import {jsonExtensionContribution} from './json.js';
import {registerDesignerLayout} from './designer-layout.js';

/** Extension ownership stays in reserved area blocks and cannot change the released manifest. */
export const bclExtensionContribution = Object.freeze({
  name: 'A07', register: registry => registerBclModules(registry, {group: 'extensions'})
});

export const collectionExtensionContribution = Object.freeze({name: 'A08', register: registerBclCollectionExtensions});
export const designerLayoutContribution = Object.freeze({name: 'A18', register: registerDesignerLayout});
export const frameworkExtensions = Object.freeze([
  bclExtensionContribution, collectionExtensionContribution, jsonExtensionContribution, designerLayoutContribution
]);
