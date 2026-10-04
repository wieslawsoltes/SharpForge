import {compareObjects} from './object-comparison.js';
import {
  resolveStringComparer, registerStringComparerExtensions, registerStringComparerFactoryExtensions, registerStringComparerEqualityExtensions
} from './string-comparer.js';
import {registerStringComparisonExtensions} from './string.js';
import {
  registerStringBuilderCharacterExtensions, registerStringBuilderInt64Extensions,
  registerStringBuilderIntegerExtensions, registerStringBuilderSingleExtensions, registerStringBuilderDecimalExtensions
} from '../text/string-builder-append.js';
import {
  registerStringSearchWindowExtensions, registerStringLastSearchStartExtensions, registerStringLastSearchWindowExtensions
} from './string-search.js';
import {registerStringBuilderIndexerExtensions} from '../text/string-builder-indexer.js';
import {registerStringBuilderCopyExtensions} from '../text/string-builder-copy.js';
import {registerStringBuilderRangeExtensions} from '../text/string-builder-append-range.js';
import {registerStringBuilderArrayExtensions} from '../text/string-builder-append-array.js';
import {registerStringBuilderValueExtensions} from '../text/string-builder-append-builder.js';
import {registerStringBuilderEqualityExtensions} from '../text/string-builder-equality.js';
import {registerStringBuilderValueRangeExtensions} from '../text/string-builder-append-builder-range.js';
import {
  registerStringBuilderCharacterEditExtensions, registerStringBuilderCharacterInsertExtensions,
  registerStringBuilderBooleanInsertExtensions, registerStringBuilderRepeatedInsertExtensions
} from '../text/string-builder-edit.js';
import {registerStringBuilderStringReplaceRangeExtensions} from '../text/string-builder-replace-range.js';

const comparerType = 'System.Collections.IComparer';

function contracts(registry) {
  registry.define(comparerType, {kind: 'bcl', typeKind: 'interface', family: 'objectComparer', base: null});
  registry.member(comparerType, 'Compare', ['object', 'object'], 'int', {isAbstract: true});
  registry.member('System.StringComparer', 'Compare', ['object', 'object'], 'int');
  registry.member('System.Array', 'BinarySearch', ['System.Array', 'object', comparerType], 'int', {isStatic: true});
  // Ordered A07 append point: new registrations follow these calls, never precede released IDs.
  registerStringComparerExtensions(registry);
  registerStringComparisonExtensions(registry);
  registerStringBuilderCharacterExtensions(registry);
  registerStringSearchWindowExtensions(registry);
  registerStringBuilderIndexerExtensions(registry);
  registerStringLastSearchStartExtensions(registry);
  registerStringBuilderCopyExtensions(registry);
  registerStringBuilderInt64Extensions(registry);
  registerStringLastSearchWindowExtensions(registry);
  registerStringBuilderRangeExtensions(registry);
  registerStringBuilderArrayExtensions(registry);
  registerStringComparerFactoryExtensions(registry);
  registerStringBuilderValueExtensions(registry);
  registerStringBuilderIntegerExtensions(registry);
  registerStringComparerEqualityExtensions(registry);
  registerStringBuilderSingleExtensions(registry);
  registerStringBuilderEqualityExtensions(registry);
  registerStringBuilderDecimalExtensions(registry);
  registerStringBuilderValueRangeExtensions(registry);
  registerStringBuilderCharacterEditExtensions(registry);
  registerStringBuilderCharacterInsertExtensions(registry);
  registerStringBuilderStringReplaceRangeExtensions(registry);
  registerStringBuilderBooleanInsertExtensions(registry);
  registerStringBuilderRepeatedInsertExtensions(registry);
}

function invoke(platform, descriptor, args) {
  const compare = resolveStringComparer(platform, args[0]);
  return {handled: true, value: compareObjects(platform, args[1], args[2], compare)};
}

/** Append related non-generic comparer contracts after the established A07 extension IDs. */
export const objectComparerModule = Object.freeze({
  name: 'objectComparer', families: ['objectComparer'], contracts, invoke, group: 'extensions'
});
