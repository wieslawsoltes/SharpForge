/** Delegate signatures for dynamic call sites, including ref/out and large signatures (SF-A02-T55). */
import { MethodAttributes, MethodImplAttributes } from '@sharpforge/cil';
import { NamedTypeSymbol, TypeKind, Accessibility, RefKind } from '../../symbols/types.js';
import { parameterFlags } from '../../codegen/metadata/attribute-flags.js';
import { frameworkType } from './framework-types.js';
import { classTypeParameterCopies, substitutionOver, selfTypeOf } from './generic-context.js';

const INVOKE_FLAGS = MethodAttributes.Public | MethodAttributes.Virtual | MethodAttributes.HideBySig | MethodAttributes.NewSlot;

/** A Func/Action when representable; otherwise a runtime-implemented delegate in the same generic scope. */
export function dynamicDelegate(plan, operation, context) {
  const core = plan.core;
  const parameters = [{ type: plan.runtime.callSite }, ...operation.arguments.map(argument => ({
    type: argument.type, refKind: argument.refKind,
  }))];
  const returnsVoid = operation.returnType.specialType === 'System_Void';
  const byReference = parameters.some(parameter => parameter.refKind && parameter.refKind !== RefKind.None);
  if (!byReference && parameters.length <= 16) {
    const argumentsList = [...parameters.map(parameter => parameter.type), ...(returnsVoid ? [] : [operation.returnType])];
    const definition = frameworkType(core, 'System', returnsVoid ? 'Action' : 'Func', {
      arity: argumentsList.length, typeKind: TypeKind.Delegate,
    });
    return {
      type: definition.construct(argumentsList),
      definition: null,
      invoke: null,
      shape: {
        isStatic: false,
        returnType: returnsVoid ? core.void : definition.typeParameters.at(-1),
        parameters: definition.typeParameters.slice(0, parameters.length).map(type => ({ type })),
      },
    };
  }
  const copies = classTypeParameterCopies(context.typeParameters);
  const definition = new NamedTypeSymbol({
    name: `<>DynamicDelegate${plan.delegateOrdinal++}`,
    typeKind: TypeKind.Delegate,
    containingSymbol: context.owner,
    declaredAccessibility: Accessibility.Private,
    baseType: () => core.multicastDelegate,
    typeParameters: copies,
    isSealed: true,
    isImplicitlyDeclared: true,
  });
  definition.isSource = true;
  definition.typeSubstitution = substitutionOver(context.typeParameters, copies);
  definition.selfType = selfTypeOf(definition, context.typeParameters);
  const shape = { isStatic: false, returnType: operation.returnType, parameters };
  const invoke = {
    symbol: null, name: 'Invoke', flags: INVOKE_FLAGS, implFlags: MethodImplAttributes.Runtime,
    hasBody: false, isCompilerGenerated: true, shape,
    parameters: parameters.map((parameter, index) => ({ name: index === 0 ? 'site' : 'arg' + index, flags: parameterFlags(parameter) })),
  };
  plan.types.push(definition);
  plan.additionsTo(definition).methods.push(invoke);
  return { type: definition.selfType, definition, invoke, shape };
}
