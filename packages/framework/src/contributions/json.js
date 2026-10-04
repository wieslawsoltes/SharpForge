/** Append JSON numeric accessors in the reserved A09 block without changing released IDs. */
export function registerJsonExtensions({member}) {
  member('System.Text.Json.JsonElement', 'GetInt64', [], 'long');
}

export const jsonExtensionContribution = Object.freeze({name: 'A09', register: registerJsonExtensions});
