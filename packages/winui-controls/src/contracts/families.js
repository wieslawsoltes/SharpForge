import { familyContractBuilder } from '../policy/contract-builder.js';
import { registerItemsContracts } from '../items/contracts.js';
import { registerTextContracts } from '../text/contracts.js';
import { registerNavigationContracts } from '../navigation/contracts.js';
import { registerCommandContracts } from '../commands/contracts.js';
import { registerValueContracts } from '../values/contracts.js';
import { registerApplicationContracts } from '../app/contracts.js';
import { registerMediaContracts } from '../media/contracts.js';

/** Exact declaring-owner/event -> concrete payload mapping; released delegates remain unchanged. */
export const controlFamilyEventContracts = new Map();

export function registerControlFamilyContracts(registry) {
  const builder = familyContractBuilder(registry, controlFamilyEventContracts);
  for (const register of [registerItemsContracts, registerTextContracts, registerNavigationContracts,
    registerCommandContracts, registerValueContracts, registerApplicationContracts, registerMediaContracts]) register(builder);
}
