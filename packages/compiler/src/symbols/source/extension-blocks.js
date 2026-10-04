/**
 * Symbols of C# 14 extension blocks (SF-A02-T83): `extension<T>(Receiver r) { members }` in a static class.
 *
 * Each member becomes a static implementation method of the enclosing class, the form the language defines for
 * metadata and the one the runtime already executes:
 *
 *   instance method  R M(P p)        static R M<T>(Receiver r, P p)      also a classic extension method (`this r`)
 *   static method    static R M(P p) static R M<T>(P p)
 *   instance property P { get; set; } static get_P<T>(Receiver r), static set_P<T>(Receiver r, P value)
 *   static property                  static get_P<T>(), static set_P<T>(P value)
 *   indexer  P this[I i] { get; set; } static get_Item<T>(Receiver r, I i), static set_Item<T>(Receiver r, I i, P value)
 *                                    (C# 15 preview, provisional: csharplang/proposals/csharp-15.0/extension-indexers.md
 *                                    revision 1, "Metadata"; the name given by IndexerNameAttribute is not applied)
 *
 * The type parameters of the block come first in the implementation's type parameter list, then the member's own.
 * The implementations are ordinary members of the class (`E.M(r, p)` and `E.get_P(r)` bind as written). What the
 * extension syntax adds is recorded in `type.extensionMembers` for the member lookups of binder/extension-members.js:
 * `{ name, kind: 'instance' | 'static' | 'operator', symbol }` where `symbol` is the implementation method or the
 * extension property. Every implementation carries `extensionReceiverType`, the receiver type in terms of its own
 * type parameters. An operator `static R operator +(A, B)` is the static method `op_Addition<T>(A, B)`.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { Accessibility, RefKind } from '../types.js';
import { MethodSymbol, PropertySymbol, ParameterSymbol, MethodKind, DeclarationModifiers, modifiersFromSyntax, accessibilityFromSyntax } from '../members.js';
import { declareTypeParameters, bindConstraintClauses } from './type-parameters.js';
import { words, spanOf, twa } from './source-type.js';
import { binaryOperatorNames, unaryOperatorNames } from '../../overload/operators.js';
import {
  checkExtensionBlock,
  checkExtensionReceiver,
  checkExtensionMember,
  checkExtensionOperator,
  disallowedMemberToken,
} from './extension-block-checks.js';

/** Class mixin for the source assembly: members of extension blocks. */
export const ExtensionBlockBuilder = Base =>
  class extends Base {
    member(type, syntax, scope, uri, members) {
      if (syntax.kind !== 'ExtensionBlockDeclaration') return super.member(type, syntax, scope, uri, members);
      const report = (node, code, args) => this.report(uri, node, code, args),
        blockArity = syntax.typeParameterList?.parameters.length ?? 0;
      type.extensionMembers ??= [];
      checkExtensionBlock(type, syntax, report);
      let receiverChecked = false;
      for (const member of syntax.members ?? []) {
        const disallowed = disallowedMemberToken(member);
        if (disallowed) {
          report(disallowed, DiagnosticId.CS9282);
          continue;
        }
        const first = members.length;
        if (member.kind === 'MethodDeclaration') this.extensionMethod(type, syntax, member, scope, uri, members);
        else if (member.kind === 'OperatorDeclaration') this.extensionOperator(type, syntax, member, scope, uri, members);
        else this.extensionProperty(type, syntax, member, scope, uri, members);
        const implementation = members[first];
        if (!implementation) continue;
        const receiver = implementation.extensionReceiver;
        if (!receiverChecked) checkExtensionReceiver(receiver, report);
        receiverChecked = true;
        if (member.kind === 'OperatorDeclaration') {
          checkExtensionOperator(member, implementation, report);
          continue;
        }
        const isIndexer = member.kind === 'IndexerDeclaration',
          // The parameters of an indexer follow the receiver; a set accessor ends with `value`.
          ownParameters = isIndexer ? implementation.parameters.slice(1, implementation.returnsVoid ? -1 : undefined) : [],
          name = isIndexer ? `this[${ownParameters.map(parameter => parameter.type.toDisplayString()).join(', ')}]` : member.identifier.valueText;
        checkExtensionMember(
          member,
          {
            name,
            isStatic: words(member.modifiers).includes('static'),
            receiver,
            display: `${type.toDisplayString()}.extension(${receiver?.type?.toDisplayString() ?? ''}).${name}`,
            blockTypeParameters: implementation.typeParameters.slice(0, blockArity),
            ownParameters,
          },
          report,
        );
      }
    }
    /**
     * One static implementation method.
     * @param {{name:string, syntax:object, declaration:object, isStatic:boolean, returnTypeSyntax:object|null,
     *   typeParameterList?:object, parameterList?:object, constraintClauses?:object[], valueType?:object}} shape
     *   `declaration` carries the modifiers; `syntax` carries the body; `valueType` adds the `value` parameter of a setter
     */
    extensionImplementation(type, block, scope, uri, shape) {
      const report = (node, code, args) => this.report(uri, node, code, args),
        list = words(shape.declaration.modifiers ?? []),
        syntax = shape.syntax;
      const method = new MethodSymbol({
        name: shape.name,
        methodKind: MethodKind.Ordinary,
        containingSymbol: type,
        // `protected` is CS9302 (extension-block-checks.js); the implementation is then private so no other rule fires.
        declaredAccessibility: list.includes('protected') ? Accessibility.Private : accessibilityFromSyntax(list, Accessibility.Private),
        modifiers: modifiersFromSyntax(list) | DeclarationModifiers.Static,
        locations: [{ uri, ...spanOf(shape.declaration.identifier ?? shape.declaration.operatorToken ?? syntax) }],
        syntax,
        typeParameters: [],
      });
      const typeParameters = [
        ...declareTypeParameters(block.typeParameterList, method, uri, report),
        ...declareTypeParameters(shape.typeParameterList, method, uri, report),
      ];
      typeParameters.forEach((parameter, ordinal) => (parameter.ordinal = ordinal));
      method.typeParameters = Object.freeze(typeParameters);
      const methodScope = typeParameters.length ? scope.child('typeParameters', { parameters: typeParameters }) : scope;
      method.scope = methodScope;
      method.uri = uri;
      method.hasBody = !!(syntax.body || syntax.expressionBody);
      method.modifierWords = list;
      let returnSyntax = shape.returnTypeSyntax;
      if (returnSyntax?.kind === 'RefType') {
        method.refKind = returnSyntax.readOnlyKeyword ? RefKind.RefReadOnly : RefKind.Ref;
        returnSyntax = returnSyntax.type;
      }
      method.returnTypeWithAnnotations = returnSyntax ? this.bindType(returnSyntax, methodScope) : twa(this.core.void);
      method.returnTypeSyntax = returnSyntax;
      const receiver = this.extensionReceiver(block, methodScope, uri);
      method.extensionReceiver = receiver[0] ?? null;
      method.extensionReceiverType = receiver[0]?.type ?? null;
      method.extensionBlock = block;
      const own = this.parameters(shape.parameterList, methodScope, uri, method),
        value = shape.valueType ? [new ParameterSymbol({ name: 'value', type: this.bindType(shape.valueType, methodScope) })] : [],
        parameters = [...(shape.isStatic ? [] : receiver), ...own, ...value];
      parameters.forEach((parameter, ordinal) => {
        parameter.ordinal = ordinal;
        parameter.containingSymbol = method;
      });
      method.parameters = Object.freeze(parameters);
      const clauses = [...(block.constraintClauses ?? []), ...(shape.constraintClauses ?? [])];
      if (clauses.length)
        bindConstraintClauses(typeParameters, clauses, t => this.bindType(t, methodScope), report, {
          ownerDisplay: shape.name,
          useFeature: (node, feature) => this.host.useFeature?.(uri, node, feature),
        });
      if (method.hasBody) this.bodies.push(method);
      return method;
    }
    /** The receiver parameter of a block as a one-element list; it has no name in `extension(int) { ... }`. */
    extensionReceiver(block, scope, uri) {
      const syntax = block.parameterList?.parameters[0];
      if (!syntax) return [];
      if (syntax.identifier && !syntax.identifier.isMissing) return this.parameters({ parameters: [syntax] }, scope, uri, null);
      return [new ParameterSymbol({ name: '', type: syntax.type ? this.bindType(syntax.type, scope) : twa(this.core.object), syntax })];
    }
    extensionMethod(type, block, syntax, scope, uri, members) {
      const isStatic = words(syntax.modifiers).includes('static'),
        method = this.extensionImplementation(type, block, scope, uri, {
          name: syntax.identifier.valueText,
          syntax,
          declaration: syntax,
          isStatic,
          returnTypeSyntax: syntax.returnType,
          typeParameterList: syntax.typeParameterList,
          parameterList: syntax.parameterList,
          constraintClauses: syntax.constraintClauses,
        });
      if (!isStatic && method.parameters[0]) {
        // An instance extension method is found by the classic extension method lookup: `receiver.M(args)`.
        method.parameters[0].isThis = true;
        method.isExtensionMethod = true;
      }
      members.push(method);
      type.extensionMembers.push({ name: method.name, kind: isStatic ? 'static' : 'instance', symbol: method });
    }
    /** `static R operator +(A a, B b)` in a block: the static method `op_Addition`, found by operator resolution. */
    extensionOperator(type, block, syntax, scope, uri, members) {
      const token = syntax.operatorToken.text,
        isStatic = words(syntax.modifiers).includes('static'),
        isUnary = syntax.parameterList.parameters.length === 1,
        name = ((isUnary ? unaryOperatorNames[token] : null) ?? binaryOperatorNames[token] ?? 'op_' + token).replace(
          /^op_/,
          syntax.checkedKeyword ? 'op_Checked' : 'op_',
        );
      const method = this.extensionImplementation(type, block, scope, uri, {
        name,
        syntax,
        declaration: syntax,
        isStatic,
        returnTypeSyntax: syntax.returnType,
        parameterList: syntax.parameterList,
      });
      method.operatorToken = token;
      members.push(method);
      // An instance (compound assignment) operator takes the receiver first; operator resolution does not use it yet.
      type.extensionMembers.push({ name, kind: isStatic ? 'operator' : 'instanceOperator', symbol: method });
    }
    /** A property of a block, or (C# 15 preview) an indexer: the same accessors with the indexer's parameters after the receiver. */
    extensionProperty(type, block, syntax, scope, uri, members) {
      const list = words(syntax.modifiers),
        isIndexer = syntax.kind === 'IndexerDeclaration',
        // "Because indexers are always instance members": `static` is CS0106 as on any indexer (binder/members).
        isStatic = list.includes('static') && !isIndexer,
        name = isIndexer ? 'this[]' : syntax.identifier.valueText;
      if (isIndexer && list.includes('static')) this.report(uri, syntax.thisKeyword, DiagnosticId.CS0106, ['static']);
      let typeSyntax = syntax.type;
      if (typeSyntax.kind === 'RefType') typeSyntax = typeSyntax.type;
      const accessor = (keyword, body) =>
        this.extensionImplementation(type, block, scope, uri, {
          name: (keyword === 'get' ? 'get_' : 'set_') + (isIndexer ? 'Item' : name),
          syntax: body,
          declaration: syntax,
          isStatic,
          returnTypeSyntax: keyword === 'get' ? syntax.type : null,
          parameterList: isIndexer ? syntax.parameterList : null,
          valueType: keyword === 'get' ? null : typeSyntax,
        });
      let getMethod = syntax.expressionBody ? accessor('get', syntax) : null,
        setMethod = null;
      for (const a of syntax.accessorList?.accessors ?? []) {
        const keyword = a.keyword.text;
        if (keyword === 'get' && !getMethod) getMethod = accessor('get', a);
        else if ((keyword === 'set' || keyword === 'init') && !setMethod) setMethod = accessor('set', a);
      }
      const typed = getMethod ?? setMethod;
      if (!typed) return;
      const property = new PropertySymbol({
        name,
        type: getMethod ? getMethod.returnTypeWithAnnotations : setMethod.parameters.at(-1).typeWithAnnotations,
        containingSymbol: type,
        declaredAccessibility: accessibilityFromSyntax(list, Accessibility.Private),
        modifiers: modifiersFromSyntax(list),
        locations: [{ uri, ...spanOf(syntax.identifier ?? syntax.thisKeyword) }],
        syntax,
      });
      if (isIndexer) {
        property.isExtensionIndexer = true;
        property.parameters = Object.freeze(typed.parameters.slice(1, getMethod ? undefined : -1));
      }
      // The accessors stay ordinary methods (they can be called by name), so they are attached without `associatedSymbol`.
      property.getMethod = getMethod;
      property.setMethod = setMethod;
      property.scope = scope;
      property.uri = uri;
      property.isExtensionProperty = true;
      property.extensionReceiverType = typed.extensionReceiverType;
      for (const method of [getMethod, setMethod]) if (method) members.push(method);
      type.extensionMembers.push({ name, kind: isStatic ? 'static' : 'instance', symbol: property });
    }
  };
