/**
 * C# 15 union declarations and custom union contracts. Pinned proposal:
 * dotnet/csharplang@412dc3023500b69f684c365762e38db6ee7564ea/proposals/csharp-15.0/unions.md revision 1.
 */
import { previewStampText } from '@sharpforge/syntax';
import { DiagnosticId } from '../diagnostics/codes.js';
import { Accessibility, SymbolKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { unionContract, unionShapeOf, unionShapeRules, UNION_ATTRIBUTE } from '../symbols/union-shape.js';
import { attributesNamed } from './bound-attributes.js';
import { isAccessible } from './accessibility.js';
import { AttributeTargets } from '../symbols/attribute-types.js';
import { describeTargets } from './attribute-targets.js';
import { effectiveAccessibility, isAtLeastAsAccessible } from './inheritance.js';
export { UnionBinding } from './unions/pattern-binding.js';

function declarationProblems(type) {
  const problems = [];
  for (const member of type.getMembers()) {
    if (member.isImplicitlyDeclared || member.isStatic) continue;
    const storesState = member.kind === SymbolKind.Field || member.isAutoProperty || member.isFieldLike;
    if (storesState) problems.push([member, 'a union declaration cannot declare instance fields, auto-properties or field-like events']);
    if (member.methodKind !== MethodKind.Constructor) continue;
    if (member.parameters.length === 1 && member.declaredAccessibility === Accessibility.Public)
      problems.push([member, 'a union declaration cannot declare a public constructor with one parameter']);
    if (member.initializerSyntax?.kind !== 'ThisConstructorInitializer')
      problems.push([member, 'a union constructor must delegate to a generated constructor through this(...)']);
  }
  return problems;
}

/** Analysis registration: required contracts, declared member restrictions, and custom basic-pattern diagnostics. */
export const UnionRules = Base => class extends Base {
  unionRule(type, node, text, unresolved = false) {
    const uri = node.uri ?? type.declarations[0].uri;
    this.report(uri, node.syntax ?? node, unresolved ? DiagnosticId.SF2202 : DiagnosticId.SF2203, [text, previewStampText('Unions')]);
  }
  bindAttributes() {
    super.bindAttributes();
    for (const type of this.assembly.types) {
      if (!this.versionOf(type.declarations[0].uri).preview) continue;
      if (type.isUnionDeclaration) {
        this.synthesizeUnionAttribute(type);
        for (const [member, rule] of declarationProblems(type)) this.unionRule(type, member, rule);
        for (const constructor of type.getMembers('.ctor')) {
          if (!constructor.unionConstructor) continue;
          const caseType = constructor.parameters[0].type;
          if (!isAtLeastAsAccessible(caseType, effectiveAccessibility(type)))
            this.reportAt(constructor, DiagnosticId.CS0051, [constructor.toDisplayString(), caseType.toDisplayString()]);
        }
      }
      const shape = unionShapeOf(type, this.core);
      if (!shape) continue;
      for (const problem of new Set(shape.problems)) {
        if (problem === 'basicPattern') {
          // Open question "custom union declarations ... missing the minimal set of APIs", lines 818-829.
          this.unionRule(type, type.syntax.identifier, 'custom unions missing the mandatory creation or Value API', true);
        } else this.unionRule(type, type.syntax.identifier, unionShapeRules[problem]);
      }
    }
  }
  synthesizeUnionAttribute(type) {
    const syntax = type.syntax.identifier;
    const attribute = unionContract(this.globalNamespace, 'UnionAttribute');
    if (!attribute) {
      this.report(type.declarations[0].uri, syntax, DiagnosticId.CS0518, [UNION_ATTRIBUTE]);
      return;
    }
    const uri = type.declarations[0].uri;
    if (!this.checkAttributeClass(attribute, syntax, uri)) return;
    const usage = this.attributeUsageOf(attribute);
    if (!(usage.validOn & AttributeTargets.Struct)) {
      this.report(uri, syntax, DiagnosticId.CS0592, [UNION_ATTRIBUTE, describeTargets(usage.validOn)]);
      return;
    }
    const constructor = attribute.getMembers('.ctor').find(member => member.methodKind === MethodKind.Constructor &&
      !member.parameters.length && isAccessible(member, type, { withinModule: this.assembly.module }));
    if (!constructor) {
      this.report(uri, syntax, DiagnosticId.CS0656, [UNION_ATTRIBUTE, '.ctor']);
      return;
    }
    if (!attributesNamed(type, UNION_ATTRIBUTE).length) type.boundAttributes.push({
      attributeClass: attribute, attributeConstructor: constructor, location: 'type', syntax,
      arguments: [], named: [], isImplicitlyDeclared: true,
    });
  }
  bindBodies() {
    super.bindBodies();
    for (const type of this.assembly.types) {
      if (!type.isUnionDeclaration || !this.versionOf(type.declarations[0].uri).preview) continue;
      for (const constructor of type.getMembers('.ctor')) {
        if (constructor.isImplicitlyDeclared || constructor.initializerSyntax?.kind !== 'ThisConstructorInitializer') continue;
        const seen = new Set();
        let target = constructor;
        while (target && !target.originalDefinition?.unionConstructor && !seen.has(target)) {
          seen.add(target);
          target = target.originalDefinition.thisTarget;
        }
        if (!target?.originalDefinition?.unionConstructor)
          this.unionRule(type, constructor, 'a union constructor chain must terminate in a generated case constructor');
      }
    }
  }
};
