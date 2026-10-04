/**
 * Captured primary constructor parameters (SF-A02-T30, C# 12): a parameter of `class C(int step)` that a member of
 * the type uses after construction is state of the instance. It gets a private field, the primary constructor stores
 * the argument there before anything else runs, and the members read and write the field.
 *
 * The plan runs before tokens are allocated; the emission half is the mixin below.
 */
import { FieldAttributes } from '@sharpforge/cil';
import { walk } from '../../bound/semantic-walker.js';
import { UnsupportedInCil } from './unsupported.js';

/**
 * Finds the captured parameters of every primary constructor.
 * @param analysis a SemanticAnalysis that has run without errors
 * @returns {{byParameter: Map<object, {field: object, owner: object}>, byType: Map<object, object[]>}} the planned
 *   field of each captured parameter, and the fields to add to each type
 */
export function planPrimaryCaptures(analysis) {
  const byParameter = new Map(),
    byType = new Map();
  for (const body of analysis.bound.values()) {
    walk(body, node => {
      if (node.kind !== 'Parameter' || !node.isPrimaryCapture || byParameter.has(node.parameter)) return true;
      const parameter = node.parameter,
        owner = parameter.containingSymbol?.containingType;
      if (!owner || owner.isGenericType) {
        throw new UnsupportedInCil('captured primary constructor parameters of a generic type', node.syntax);
      }
      const name = `<${parameter.name}>P`,
        field = { symbol: null, name, flags: FieldAttributes.Private, type: parameter.type, constant: null, isCompilerGenerated: true };
      byParameter.set(parameter, { field, owner });
      if (!byType.has(owner)) byType.set(owner, []);
      byType.get(owner).push(field);
      return true;
    });
  }
  return { byParameter, byType };
}

/** Class mixin: captured primary constructor parameters. */
export const PrimaryCaptureEmission = Base =>
  class extends Base {
    /** Outside the primary constructor a captured parameter is the field of `this` that holds it. */
    parameterLocation(parameter, syntax) {
      const capture = this.program.primaryCaptures.get(parameter);
      if (!capture || this.argumentIndexes.has(parameter)) return super.parameterLocation(parameter, syntax);
      const receiver = { kind: 'This', type: capture.owner, syntax };
      return this.tokenFieldLocation({ token: capture.field.token, isStatic: false }, receiver, parameter.type);
    }
    /** The primary constructor stores its captured arguments first, so that initializers and members see them. */
    constructorPrologue(constructor) {
      if (constructor.isPrimaryConstructor) {
        for (const parameter of constructor.parameters) {
          const capture = this.program.primaryCaptures.get(parameter);
          if (!capture) continue;
          this.il.emit('ldarg', 0).emit('ldarg', this.argumentIndexOf(parameter)).emit('stfld', capture.field.token);
        }
      }
      return super.constructorPrologue(constructor);
    }
  };
