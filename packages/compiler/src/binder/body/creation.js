/**
 * Object, delegate and array creation and target-typed `new`; initializers are bound in ../members/initializers.js.
 */
import { SymbolKind, TypeKind, ArrayTypeSymbol } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { Conversion, ConversionKind } from '../../conversions/classify.js';
import { numericKind } from '../../conversions/numeric.js';
import { isNullableType, stripNullable } from '../../conversions/nullable.js';
import { isAccessible } from '../accessibility.js';

const isSource = symbol => {
  for (let s = symbol?.originalDefinition ?? symbol; s; s = s.containingSymbol) if (s.isSource || s.containingAssembly) return true;
  return false;
};
const keywordOf = type =>
  numericKind(type) ??
  { System_Boolean: 'bool', System_String: 'string', System_Char: 'char', System_Object: 'object' }[type?.specialType] ??
  null;

/** Class mixin: Object, delegate and array creation with object and collection initializers and target-typed `new`. */
export const CreationBinding = Base =>
  class extends Base {
    objectCreation(syntax) {
      const type = this.bindType(syntax.type).type,
        args = this.arguments(syntax.argumentList);
      if (type.isErrorType()) {
        if (syntax.initializer) this.initializerSilently(syntax.initializer);
        return this.bad(syntax);
      }
      return this.create(type, args, syntax, syntax.type, syntax.initializer);
    }
    implicitCreation(syntax) {
      const args = this.arguments(syntax.argumentList);
      return this.node('ImplicitNew', syntax, null, {
        form: 'implicitNew',
        args,
        convert: to => {
          const t = stripNullable(to);
          return t.typeKind === TypeKind.Interface ||
            (t.typeKind === TypeKind.TypeParameter && !t.hasConstructorConstraint) ||
            t instanceof ArrayTypeSymbol
            ? null
            : new Conversion(ConversionKind.ObjectCreation);
        },
        materialize: to => this.create(stripNullable(to), args, syntax, syntax.newKeyword, syntax.initializer),
      });
    }
    create(type, args, syntax, typeNode, initializer) {
      const anyBad = args.some(a => a.hasErrors);
      if (type.typeKind === TypeKind.Delegate) {
        if (args.length !== 1) {
          this.report(syntax, 'CS0149');
          return this.bad(syntax);
        }
        const a = args[0];
        if (a.hasErrors) return this.bad(syntax);
        if (a.kind === 'MethodGroup' || a.form === 'lambda') {
          const converted = this.convert(a, type, a.syntax);
          if (a.form === 'lambda' && !converted.hasErrors) this.finishLambda(a, type);
          return converted.hasErrors ? converted : this.node('DelegateCreation', syntax, type, { operand: converted });
        }
        if (a.type?.typeKind === TypeKind.Delegate) return this.node('DelegateCreation', syntax, type, { operand: a });
        this.report(a.syntax, 'CS0149');
        return this.bad(syntax);
      }
      if (type.typeKind === TypeKind.Interface || (type.isAbstract && type.typeKind === TypeKind.Class)) {
        this.report(syntax, 'CS0144', [this.display(type)]);
        if (initializer) this.initializerSilently(initializer);
        return this.bad(syntax);
      }
      if (type.isStatic) {
        this.report(typeNode, 'CS0712', [this.display(type)]);
        return this.bad(syntax);
      }
      if (type.typeKind === TypeKind.TypeParameter) {
        if (!type.hasConstructorConstraint && !type.hasValueTypeConstraint) {
          this.report(syntax, 'CS0304', [type.name]);
          return this.bad(syntax);
        }
        if (args.length) {
          this.report(syntax, 'CS0417', [type.name]);
          return this.bad(syntax);
        }
        return this.withInitializer(this.node('ObjectCreation', syntax, type, { constructor: null, args: [] }), initializer);
      }
      if (type.typeKind === TypeKind.Enum || (keywordOf(type) && type.isValueType) || isNullableType(type)) {
        if (!args.length)
          return this.withInitializer(this.node('ObjectCreation', syntax, type, { constructor: null, args: [] }), initializer);
        if (!isSource(type)) return this.lenient(syntax);
      }
      const all = type.getMembers('.ctor').filter(m => m.kind === SymbolKind.Method && m.methodKind === MethodKind.Constructor);
      if (!all.length) {
        if (type.isValueType === true && !args.length)
          return this.withInitializer(this.node('ObjectCreation', syntax, type, { constructor: null, args: [] }), initializer);
        if (!isSource(type)) {
          if (initializer) this.initializerSilently(initializer, type);
          return this.lenient(syntax);
        }
      }
      const accessible = all.filter(c =>
        isAccessible(c.originalDefinition ?? c, this.c.containingType?.originalDefinition ?? null, {
          throughType: type.originalDefinition,
        }),
      );
      if (all.length && !accessible.length) {
        if (
          isAccessible(type.originalDefinition, this.c.containingType?.originalDefinition ?? null, { withinModule: this.d.assembly.module })
        )
          this.report(typeNode, 'CS0122', [all[0].toDisplayString()]);
        return this.bad(syntax);
      }
      const r = this.d.overloads.resolve(accessible, args, { isConstructor: true });
      if (!r.succeeded) {
        if (anyBad) {
          if (initializer) this.initializerSilently(initializer, type);
          return this.bad(syntax);
        }
        if (!isSource(type)) {
          if (initializer) this.initializerSilently(initializer, type);
          return this.lenient(syntax);
        }
        // A less accessible constructor that would have matched is reported as inaccessible.
        const hidden = all.length > accessible.length ? this.d.overloads.resolve(all, args, { isConstructor: true }) : null;
        if (hidden?.succeeded) {
          this.report(typeNode, 'CS0122', [hidden.method.toDisplayString()]);
          return this.bad(syntax);
        }
        const e = r.error;
        this.report(this.errorNode(e, args, typeNode), e.code, e.code === 'CS1729' ? [this.display(type), args.length] : e.args);
        if (initializer) this.initializerSilently(initializer, type);
        return this.bad(syntax);
      }
      const call = this.finishCall(r, null, args, syntax, {});
      return this.withInitializer(
        this.node('ObjectCreation', syntax, type, { constructor: r.method, args: call.args, expanded: r.expanded }),
        initializer,
      );
    }
    arrayCreation(syntax) {
      const implicit = syntax.kind === 'ImplicitArrayCreationExpression',
        init = syntax.initializer;
      let elementType,
        rank = 1,
        sizes = [];
      if (implicit) {
        rank = syntax.commas.length + 1;
        const values = init.expressions.map(e => (e.kind === 'ArrayInitializerExpression' ? null : this.value(e)));
        if (values.some(v => v === null)) return this.lenient(syntax);
        if (values.some(v => v.hasErrors)) return this.bad(syntax);
        elementType = this.bestCommonType(values);
        if (!elementType) {
          this.report(syntax, 'CS0826');
          return this.bad(syntax);
        }
        return this.node('ArrayCreation', syntax, this.core.arrayOf(elementType, rank), {
          elements: values.map(v => this.convert(v, elementType)),
        });
      }
      const typeSyntax = syntax.type,
        ranks = typeSyntax.rankSpecifiers,
        full = this.bindType(typeSyntax).type;
      if (full.isErrorType() || !(full instanceof ArrayTypeSymbol)) {
        if (init) for (const e of init.expressions) if (!e.kind.endsWith('InitializerExpression')) this.value(e);
        return this.bad(syntax);
      }
      elementType = full.elementType;
      rank = full.rank;
      for (const size of ranks[0].sizes) {
        if (size.kind === 'OmittedArraySizeExpression') continue;
        const s = this.value(size);
        let done = false;
        if (!s.hasErrors) {
          for (const t of [this.core.int, this.core.uint, this.core.long, this.core.ulong]) {
            const c = this.conversions.classifyFromExpression(s, t);
            if (c.exists && c.isImplicit) {
              sizes.push(this.applyConversion(s, t, c));
              done = true;
              break;
            }
          }
          if (!done) sizes.push(this.convert(s, this.core.int));
        }
        if (s.constantValue?.isIntegral && s.constantValue.bigint < 0n) this.report(size, 'CS0248');
      }
      if (!init && !sizes.length && ranks[0].sizes.every(s => s.kind === 'OmittedArraySizeExpression')) {
        this.report(typeSyntax.rankSpecifiers[0], 'CS1586');
      }
      const elements = init ? this.arrayInitializer(init, elementType, rank) : null;
      return this.node('ArrayCreation', syntax, full, { sizes, elements });
    }
    arrayInitializer(init, elementType, rank) {
      return init.expressions.map(e => {
        if (e.kind === 'ArrayInitializerExpression') {
          if (rank > 1) return this.arrayInitializer(e, elementType, rank - 1);
          if (elementType instanceof ArrayTypeSymbol)
            return this.node('ArrayCreation', e, elementType, {
              elements: this.arrayInitializer(e, elementType.elementType, elementType.rank),
            });
          this.report(e, 'CS0623');
          return this.bad(e);
        }
        if (rank > 1) {
          this.report(e, 'CS0846');
          return this.bad(e);
        }
        return this.convert(this.value(e), elementType, e);
      });
    }
    materializeNew(e, type) {
      const c = e.convert(type);
      if (!c) {
        this.reportConversionFailure(e, type, e.syntax, null);
        return this.bad(e.syntax);
      }
      return e.materialize(type);
    }
  };
