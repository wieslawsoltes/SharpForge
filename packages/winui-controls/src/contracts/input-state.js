import { addProperty } from './contract-registration.js';

/** Append after the existing A16 contributions so earlier published contract IDs remain unchanged. */
export function registerInputStateContracts(registry) {
  addProperty(registry, registry.XAML + 'UIElement', 'FocusState', registry.XAML + 'FocusState', 0, true);
}
