import {environmentDictionaryContracts, invokeEnvironmentDictionary} from './environment-dictionary.js';

function contracts(registry) {
  registry.member('System.Environment', 'GetEnvironmentVariables', [], 'System.Collections.IDictionary', {isStatic: true});
  registry.prop('System.Environment', 'CurrentDirectory', 'string', null, true, true);
  environmentDictionaryContracts(registry);
}

/** Append session environment APIs after released comparer IDs without changing their dispatch ownership. */
export const environmentDictionaryModule = Object.freeze({
  name: 'environmentDictionary',
  families: ['environment-dictionary', 'environment-collection', 'environment-enumerator'],
  contracts,
  invoke: invokeEnvironmentDictionary
});
