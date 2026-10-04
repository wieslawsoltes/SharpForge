/**
 * The framework types of async streams that the symbol table does not model (SF-A02-T30): the builder and the
 * promise of an async iterator, the value-task source interfaces it implements, and `CancellationToken`.
 */
import { TypeKind } from '../../symbols/types.js';
import { frameworkType } from './framework-types.js';

const COMPILER_SERVICES = 'System.Runtime.CompilerServices';
const SOURCES = 'System.Threading.Tasks.Sources';
const struct = { typeKind: TypeKind.Struct };

/**
 * @param core the CoreTypes of the compilation
 * @returns {{builder, promiseDefinition, promise, typedSourceDefinition, typedSource, source, status, flags,
 *   cancellationToken}} `promise` is `ManualResetValueTaskSourceCore<bool>` and `typedSource` `IValueTaskSource<bool>`;
 *   the definitions are for signatures over their type parameter
 */
export function asyncStreamTypes(core) {
  const promiseDefinition = frameworkType(core, SOURCES, 'ManualResetValueTaskSourceCore', { ...struct, arity: 1 }),
    typedSourceDefinition = frameworkType(core, SOURCES, 'IValueTaskSource', { typeKind: TypeKind.Interface, arity: 1 });
  return {
    builder: frameworkType(core, COMPILER_SERVICES, 'AsyncIteratorMethodBuilder', struct),
    promiseDefinition,
    promise: promiseDefinition.construct(core.bool),
    typedSourceDefinition,
    typedSource: typedSourceDefinition.construct(core.bool),
    source: frameworkType(core, SOURCES, 'IValueTaskSource', { typeKind: TypeKind.Interface }),
    status: frameworkType(core, SOURCES, 'ValueTaskSourceStatus', struct),
    flags: frameworkType(core, SOURCES, 'ValueTaskSourceOnCompletedFlags', struct),
    cancellationToken: frameworkType(core, 'System.Threading', 'CancellationToken', struct),
  };
}
