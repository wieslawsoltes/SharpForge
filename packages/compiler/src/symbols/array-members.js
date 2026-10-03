/**
 * The members of System.Array every array has and the closed framework registry does not list (SF-A02-T45):
 * `GetLength`, `GetLowerBound` and `GetUpperBound`. (`Length`, `Rank` and `LongLength` are bound as array length
 * nodes by the member-access binder.) Each symbol carries `arrayMember`, the name code generation lowers it by.
 */
import { Accessibility } from './types.js';
import { MethodSymbol, ParameterSymbol } from './members.js';

/** The methods of System.Array that take a dimension. */
export const arrayDimensionMethods = Object.freeze(['GetLength', 'GetLowerBound', 'GetUpperBound']);

/** Declares the methods once per bridge; a referenced core library declares them itself. */
export function declareArrayMembers(core) {
  if (core.bridge.assembly || core.array.isErrorType()) return;
  const bridge = core.bridge.bridge ?? core.bridge;
  if (bridge.arrayMembersDeclared) return;
  bridge.arrayMembersDeclared = true;
  for (const name of arrayDimensionMethods) {
    if (core.array.getMembers(name).some(member => member.parameters?.length === 1)) continue;
    const method = new MethodSymbol({
      name,
      returnType: core.int,
      parameters: [new ParameterSymbol({ name: 'dimension', type: core.int })],
      declaredAccessibility: Accessibility.Public,
      isImplicitlyDeclared: true,
    });
    method.arrayMember = name;
    core.array.addMember(method);
  }
}
