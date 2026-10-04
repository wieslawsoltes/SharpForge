/** Direct CIL function pointers: native-width storage, ldftn and calli with exact StandAloneSig signatures. */
import { RefKind, TypeKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { isVoid } from './type-facts.js';

const isFunctionPointer = type => type?.typeKind === TypeKind.FunctionPointer;
const isFunctionPointerCall = node => node.method?.methodKind === MethodKind.FunctionPointerSignature;

/** Class mixin. Register after PointerEmission and ReferenceEmission. */
export const FunctionPointerEmission = Base =>
  class extends Base {
    exprFunctionPointerLoad(node) {
      const method = node.method;
      if (method.methodKind === MethodKind.LocalFunction) {
        const plan = this.functionPlan(method.originalDefinition ?? method, node.syntax);
        if (plan.closure) return this.unsupported('a function pointer to a local function with a closure', node.syntax);
        return this.il.emit('ldftn', this.functionToken(plan, method));
      }
      if (node.constrainedTo?.typeKind === TypeKind.TypeParameter && method.containingType?.typeKind === TypeKind.Interface) {
        this.il.emit('constrained.', this.tokens.type(node.constrainedTo));
      }
      return this.il.emit('ldftn', this.tokens.method(method));
    }
    /** Evaluate the target once before arguments, then move its saved value to the top required by calli. */
    functionPointerCall(node) {
      const pointer = node.receiver;
      const slot = this.temp(pointer.type);
      this.expression(pointer);
      this.il.emit('stloc', slot);
      this.arguments(node, node.method);
      this.il.emit('ldloc', slot);
      return this.il.emit('calli', this.tokens.functionPointer(pointer.type), {
        pops: node.method.parameters.length + 1,
        pushes: isVoid(node.type) ? 0 : 1,
      });
    }
    exprCall(node, isUsed) {
      if (!isFunctionPointerCall(node)) return super.exprCall(node, isUsed);
      this.functionPointerCall(node);
      if (node.method.refKind !== RefKind.None && !this.returningReference) this.loadIndirect(node.type);
      return undefined;
    }
    referenceCall(node) {
      return isFunctionPointerCall(node) ? this.functionPointerCall(node) : super.referenceCall(node);
    }
    defaultValue(type) {
      if (!isFunctionPointer(type)) return super.defaultValue(type);
      return this.il.emit('ldc.i4', 0).emit('conv.u');
    }
    loadIndirect(type) {
      return isFunctionPointer(type) ? this.il.emit('ldind.i') : super.loadIndirect(type);
    }
    storeIndirect(type) {
      return isFunctionPointer(type) ? this.il.emit('stind.i') : super.storeIndirect(type);
    }
    loadElement(type) {
      return isFunctionPointer(type) ? this.il.emit('ldelem.i') : super.loadElement(type);
    }
    storeElement(type) {
      return isFunctionPointer(type) ? this.il.emit('stelem.i') : super.storeElement(type);
    }
    exprConversion(node) {
      if (!isFunctionPointer(node.type)) return super.exprConversion(node);
      if (node.operand.literal === 'null' || node.conversion?.kind === 'DefaultLiteral') return this.defaultValue(node.type);
      if (node.conversion?.kind === 'ImplicitFunctionPointer') return this.expression(node.operand);
      return super.exprConversion(node);
    }
  };
