/**
 * Unsafe code (SF-A02-T47, C# spec 23): unsafe contexts, pointer types and the pointer expressions.
 *
 *   contexts     an `unsafe` modifier or block needs the /unsafe option (CS0227); a pointer type, `&x`, `*p`, `p->m`,
 *                `p[i]` and `sizeof` of a type without a predefined size need an unsafe context (CS0214, CS0233)
 *   &x           the operand is a variable (CS0211); a moveable one - a field of an object, a static field, an array
 *                element - only in a fixed statement initializer (CS0212); the result is a `T*` (CS8500 warns for a
 *                managed T, also for pointer types written in source)
 *   *p, p->m     the operand is a pointer (CS0193) and not `void*` (CS0242)
 *   p[i]         one index (CS0196) of an integral type
 *   fixed        the local is a pointer (CS0209) with an initializer (CS0210): an array, a string, or the address of
 *                a moveable variable (CS0213 for one that is already fixed), a value whose type has an instance
 *                `ref T GetPinnableReference()` (C# 7.3), CS8385 for anything else; the local is read-only (CS1656)
 *
 * Pointer arithmetic and comparisons are in overload/pointer-operators.js, pointer conversions in
 * conversions/pointer.js, declaration-level rules in ./unsafe-declarations.js. Nothing here is executable: the image
 * has typed slots and fields only, so code generation reports pointers as a runtime gap.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { RefKind, SymbolKind, PointerTypeSymbol, ArrayTypeSymbol } from '../symbols/types.js';
import { lookupMembers } from './inheritance.js';
import { LocalDeclarationKind } from '../symbols/members.js';
import { isPointerType, isVoidPointer } from '../conversions/pointer.js';
import {
  isUnsafeSymbol,
  isManagedType,
  findPointerSyntax,
  unsafeMarker,
  isUnmanagedConstructedType,
  pointsAtConstructedType,
} from './unsafe-declarations.js';

const pointerExpressions = new Set(['AddressOfExpression', 'PointerIndirectionExpression', 'PointerMemberAccessExpression']);
const isFixedBuffer = expression => expression.kind === 'FieldAccess' && (expression.field.originalDefinition ?? expression.field).isFixedSizeBuffer;

/**
 * True for a variable whose storage cannot be moved by the collector: a local, a value parameter, a field of such a
 * variable when it is a struct, and whatever a pointer already designates.
 */
export function isFixedVariable(expression) {
  switch (expression.kind) {
    case 'Local':
      return (expression.local.refKind ?? RefKind.None) === RefKind.None && !expression.local.isCaptured;
    case 'Parameter':
      return (expression.parameter.refKind ?? RefKind.None) === RefKind.None;
    case 'PointerIndirection':
    case 'PointerElementAccess':
      return true;
    case 'FieldAccess':
      return (
        !expression.field.isStatic && !!expression.receiver && expression.receiver.type?.isValueType === true && isFixedVariable(expression.receiver)
      );
    default:
      return false;
  }
}

function isVariable(expression) {
  if (expression.kind === 'ImplicitIndexerAccess') return expression.accessKind === 'index' && isVariable(expression.access);
  return ['Local', 'Parameter', 'FieldAccess', 'ArrayAccess', 'PointerIndirection', 'PointerElementAccess'].includes(expression.kind);
}

/** Class mixin of the body binder: unsafe contexts and pointer expressions. */
export const UnsafeBinding = Base =>
  class extends Base {
    /** True inside an unsafe block or a member or type declared `unsafe`. */
    get inUnsafeContext() {
      for (let binder = this; binder; binder = binder.c.parent) {
        if (binder.unsafeBlocks > 0) return true;
        binder.c.isUnsafeDeclaration ??= isUnsafeSymbol(binder.c.member ?? binder.c.method, binder.c.containingType);
        if (binder.c.isUnsafeDeclaration) return true;
      }
      return false;
    }
    requireUnsafe(node) {
      if (!this.inUnsafeContext) this.report(node, DiagnosticId.CS0214);
    }
    bindType(syntax, options) {
      const bound = super.bindType(syntax, options),
        at = findPointerSyntax(syntax);
      if (at) {
        this.requireUnsafe(unsafeMarker(at));
        this.warnManagedPointee(bound.type, at);
        if (pointsAtConstructedType(bound.type)) this.d.gate(this.c.uri, at, 'UnmanagedConstructedTypes');
      }
      return bound;
    }
    warnManagedPointee(type, node) {
      for (let t = type; t; t = t.elementType ?? t.pointedAtType) {
        if (isPointerType(t) && isManagedType(t.pointedAtType)) {
          this.report(node, DiagnosticId.CS8500, [this.display(t.pointedAtType)]);
          return;
        }
        if (!(t instanceof ArrayTypeSymbol) && !isPointerType(t)) return;
      }
    }
    statement(syntax) {
      if (syntax.kind === 'FixedStatement') return this.fixedStatement(syntax);
      if (syntax.kind !== 'UnsafeStatement') return super.statement(syntax);
      if (!this.d.options?.allowUnsafe) this.report(syntax.unsafeKeyword, DiagnosticId.CS0227);
      this.unsafeBlocks = (this.unsafeBlocks ?? 0) + 1;
      try {
        return super.statement(syntax);
      } finally {
        this.unsafeBlocks--;
      }
    }
    expression(syntax, options = {}) {
      if (syntax.kind === 'SizeOfExpression') {
        const size = super.expression(syntax, options);
        if (!size.constantValue && !size.hasErrors && !this.inUnsafeContext) this.report(syntax, DiagnosticId.CS0233, [syntax.type.toString().trim()]);
        if (isUnmanagedConstructedType(super.bindType(syntax.type).type)) this.d.gate(this.c.uri, syntax, 'UnmanagedConstructedTypes');
        return size;
      }
      if (!pointerExpressions.has(syntax.kind)) return super.expression(syntax, options);
      if (syntax.kind === 'AddressOfExpression') return this.addressOf(syntax, false);
      const operand = this.value(syntax.kind === 'PointerMemberAccessExpression' ? syntax.expression : syntax.operand);
      if (operand.hasErrors) return this.bad(syntax);
      const target = this.dereference(operand, syntax);
      if (target.hasErrors || syntax.kind === 'PointerIndirectionExpression') return target;
      const name = syntax.name.identifier.valueText;
      return this.instanceMember(target, target.type, name, syntax.name, syntax, this.typeArgumentsOf(syntax.name), options);
    }
    /** `*p`: the variable a pointer designates. */
    dereference(operand, syntax) {
      this.requireUnsafe(syntax.kind === 'PointerIndirectionExpression' ? syntax.operand : syntax);
      if (!isPointerType(operand.type)) {
        this.report(syntax, DiagnosticId.CS0193);
        return this.bad(syntax);
      }
      if (isVoidPointer(operand.type)) {
        this.report(syntax, DiagnosticId.CS0242);
        return this.bad(syntax);
      }
      return this.node('PointerIndirection', syntax, operand.type.pointedAtType, { operand });
    }
    /** `&x`. In a fixed statement initializer the operand is a moveable variable; anywhere else a fixed one. */
    addressOf(syntax, inFixedInitializer) {
      const operand = this.expression(syntax.operand);
      if (operand.hasErrors) return this.bad(syntax);
      this.requireUnsafe(syntax);
      if (!isVariable(operand) || !operand.type) {
        let written = syntax.operand;
        while (written.kind === 'ParenthesizedExpression') written = written.expression;
        this.report(written, DiagnosticId.CS0211);
        return this.bad(syntax);
      }
      // Taking the address is a use and a possible write of the variable, whatever is wrong with where it is taken.
      this.markRead(operand);
      this.markWrite(operand, null);
      if (operand.kind === 'Local') operand.local.nonConstantWrite = true;
      const isFixed = isFixedVariable(operand);
      if (inFixedInitializer && isFixed) this.report(syntax, DiagnosticId.CS0213);
      else if (!inFixedInitializer && !isFixed) {
        this.report(syntax, DiagnosticId.CS0212);
        return this.bad(syntax);
      }
      if (isManagedType(operand.type)) this.report(syntax, DiagnosticId.CS8500, [this.display(operand.type)]);
      else if (isUnmanagedConstructedType(operand.type)) this.d.gate(this.c.uri, syntax, 'UnmanagedConstructedTypes');
      return this.node('AddressOf', syntax, new PointerTypeSymbol(operand.type), { operand });
    }
    /** A pointer has no members: `p.M` is CS1061 (`p->M` is the member of what it points at). */
    instanceMember(left, type, name, nameSyntax, syntax, typeArguments, options) {
      if (!isPointerType(type)) return super.instanceMember(left, type, name, nameSyntax, syntax, typeArguments, options);
      this.report(nameSyntax, DiagnosticId.CS1061, [this.display(type), name]);
      return this.bad(syntax);
    }
    elementAccessOn(target, args, syntax) {
      if (target.hasErrors || !isPointerType(target.type)) return super.elementAccessOn(target, args, syntax);
      if (args.some(argument => argument.hasErrors)) return this.bad(syntax);
      this.requireUnsafe(syntax);
      if (args.length !== 1) {
        this.report(syntax, DiagnosticId.CS0196);
        return this.bad(syntax);
      }
      if (isVoidPointer(target.type)) {
        this.report(syntax, DiagnosticId.CS0242);
        return this.bad(syntax);
      }
      // C# 7.3: a fixed-size buffer of a moveable variable is indexed without pinning it first.
      if (isFixedBuffer(target) && target.receiver && !isFixedVariable(target.receiver))
        this.d.gate(this.c.uri, target.syntax, 'IndexingMovableFixedBuffers');
      // The elements of a fixed-size buffer are reached through a pointer into the variable that holds the struct:
      // Roslyn counts that as a write of the variable (no CS0649 for a field that is only indexed).
      if (isFixedBuffer(target) && target.receiver) this.markWrite(target.receiver, null);
      let index = null;
      for (const type of [this.core.int, this.core.uint, this.core.long, this.core.ulong]) {
        const conversion = this.conversions.classifyFromExpression(args[0], type);
        if (conversion.exists && conversion.isImplicit) {
          index = this.applyConversion(args[0], type, conversion);
          break;
        }
      }
      index ??= this.convert(args[0], this.core.int);
      if (index.hasErrors) return this.bad(syntax);
      return this.node('PointerElementAccess', syntax, target.type.pointedAtType, { pointer: target, index });
    }
    /** `T* p = stackalloc T[n];`: the allocation is a `T*` when it initializes a local of a pointer type. */
    stackAlloc(syntax) {
      const declaration = syntax.parent?.kind === 'EqualsValueClause' ? syntax.parent.parent?.parent : null,
        isPointerLocal = declaration?.kind === 'VariableDeclaration' && declaration.type.kind === 'PointerType';
      if (!isPointerLocal || syntax.kind !== 'StackAllocArrayCreationExpression') return super.stackAlloc(syntax);
      const arrayType = this.bindType(syntax.type).type;
      if (!(arrayType instanceof ArrayTypeSymbol) || arrayType.isErrorType()) return super.stackAlloc(syntax);
      const elementType = arrayType.elementType,
        sizeSyntax = syntax.type.rankSpecifiers[0]?.sizes.find(candidate => candidate.kind !== 'OmittedArraySizeExpression'),
        size = sizeSyntax ? this.convert(this.value(sizeSyntax), this.core.int, sizeSyntax) : null,
        values = syntax.initializer?.expressions.map(expression => this.convert(this.value(expression), elementType, expression)) ?? null;
      this.requireUnsafe(syntax);
      return this.node('StackAlloc', syntax, new PointerTypeSymbol(elementType), { elementType, sizes: size ? [size] : [], elements: values });
    }
    fixedStatement(syntax) {
      this.pushScope();
      try {
        const declaration = syntax.declaration,
          declared = this.bindType(declaration.type).type,
          isPointer = isPointerType(declared),
          locals = [];
        for (const declarator of declaration.variables) {
          const name = declarator.identifier.valueText,
            init = declarator.initializer?.value ?? null,
            local = this.newLocal(name, declared, declarator.identifier, LocalDeclarationKind.Fixed);
          let value = null;
          if (!isPointer && !declared.isErrorType()) this.report(declarator, DiagnosticId.CS0209);
          if (!init) {
            this.report(declarator.identifier, DiagnosticId.CS0210);
            // The missing initializer is the error; the local is not reported as unused on top of it.
            local.reads++;
          } else {
            value = this.fixedInitializer(init, isPointer ? declared : null);
            local.writes++;
            local.hasInitializer = true;
            local.nonConstantWrite = true;
          }
          this.declare(name, local, declarator.identifier);
          locals.push({ local, value });
        }
        const body = this.embedded(syntax.statement);
        return { kind: 'Fixed', syntax, completes: body.completes, declaration: locals, body };
      } finally {
        this.popScope();
      }
    }
    /** C# 7.3: the `T` of an accessible instance method `ref T GetPinnableReference()` of `type`, or null. */
    pinnableElementType(type) {
      if (!type || type.isErrorType?.()) return null;
      const method = lookupMembers(type, 'GetPinnableReference', this.core, { within: this.c.containingType }).members.find(
        member => member.kind === SymbolKind.Method && !member.isStatic && !member.parameters.length && !member.typeParameters?.length,
      );
      const returnsReference = method && (method.refKind ?? RefKind.None) !== RefKind.None;
      return returnsReference && method.returnType && !method.returnType.isErrorType?.() ? method.returnType : null;
    }
    /** The pointer a fixed statement initializer yields, converted to the declared pointer type. */
    fixedInitializer(init, pointerType) {
      let pointer;
      if (init.kind === 'AddressOfExpression') pointer = this.addressOf(init, true);
      else {
        const value = this.value(init),
          type = value.type;
        if (value.hasErrors) return value;
        let element = null;
        if (type instanceof ArrayTypeSymbol) element = type.elementType;
        else if (type?.specialType === 'System_String') element = this.core.char;
        else if (isPointerType(type) && isFixedBuffer(value)) element = type.pointedAtType;
        if (!element && (element = this.pinnableElementType(type))) this.d.gate(this.c.uri, init, 'ExtensibleFixedStatement');
        if (!element) {
          this.report(init, DiagnosticId.CS8385);
          return this.bad(init);
        }
        pointer = this.node('FixedInitializer', init, new PointerTypeSymbol(element), { operand: value });
      }
      return pointer.hasErrors || !pointerType ? pointer : this.convert(pointer, pointerType, init);
    }
  };
