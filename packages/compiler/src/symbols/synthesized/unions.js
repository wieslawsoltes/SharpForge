/** Union declaration symbols: ordinary structs with one object reference and generated case constructors. */
import { DiagnosticId } from '../../diagnostics/codes.js';
import { previewStampText } from '@sharpforge/syntax';
import { Accessibility, NullableAnnotation, SymbolKind, TypeKind, TypeWithAnnotations } from '../types.js';
import { DeclarationModifiers, FieldSymbol, MethodKind, MethodSymbol, ParameterSymbol, PropertySymbol } from '../members.js';
import { Conversions } from '../../conversions/classify.js';
import { unionContract, UNION_INTERFACE } from '../union-shape.js';
import { spanOf } from '../source/source-type.js';

const declarationsOf = type => type.declarations.filter(part => part.syntax.kind === 'UnionDeclaration');

function valueProperty(type, core) {
  const nullableObject = new TypeWithAnnotations(core.object, NullableAnnotation.Annotated);
  const options = { containingSymbol: type, declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true, locations: type.locations };
  const getter = new MethodSymbol({ ...options, name: 'get_Value', methodKind: MethodKind.PropertyGet, returnType: nullableObject, parameters: [] });
  getter.isAutoAccessor = true;
  const property = new PropertySymbol({ ...options, name: 'Value', type: nullableObject, getMethod: getter });
  property.isAutoProperty = true;
  property.backingField = new FieldSymbol({
    name: '<Value>k__BackingField', type: nullableObject, containingSymbol: type,
    declaredAccessibility: Accessibility.Private, modifiers: DeclarationModifiers.ReadOnly,
    isImplicitlyDeclared: true, associatedSymbol: property,
  });
  getter.associatedSymbol = property;
  return property;
}

function caseConstructor(type, property, caseType, { part, syntax }, core) {
  const parameter = new ParameterSymbol({ name: 'value', type: caseType });
  const constructor = new MethodSymbol({
    name: '.ctor', methodKind: MethodKind.Constructor, returnType: core.void, parameters: [parameter],
    containingSymbol: type, declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true,
    locations: [{ uri: part.uri, ...spanOf(syntax) }],
  });
  constructor.unionConstructor = property;
  constructor.uri = part.uri;
  constructor.scope = type.scopeFor(part);
  constructor.hasBody = true;
  return constructor;
}

/** Source-assembly registration: only union declarations add members or a required interface. */
export const UnionSymbolBuilder = Base => class extends Base {
  resolveBases(type) {
    super.resolveBases(type);
    if (type._baseState !== 2 || type.unionBasesResolved) return;
    type.unionBasesResolved = true;
    const part = type.declarations.find(declaration => declaration.syntax.kind === 'UnionDeclaration');
    if (!part) return;
    type.isUnionDeclaration = true;
    const contract = unionContract(this.merged, 'IUnion');
    if (!contract) this.report(part.uri, part.syntax.identifier, DiagnosticId.CS0518, [UNION_INTERFACE]);
    else if (contract.typeKind !== TypeKind.Interface) this.unionDeclarationError(part, part.syntax.identifier, 'IUnion must be an interface');
    else if (!type._declaredInterfaces.some(iface => iface.equals(contract))) type._declaredInterfaces.push(contract);
  }
  implicitConstructors(type, members) {
    const parts = declarationsOf(type);
    if (parts.length) this.synthesizeUnion(type, members, parts);
    super.implicitConstructors(type, members);
  }
  unionDeclarationError(part, node, text) {
    this.report(part.uri, node, DiagnosticId.SF2203, [text, previewStampText('Unions')]);
  }
  synthesizeUnion(type, members, parts) {
    type.isUnionDeclaration = true;
    const property = valueProperty(type, this.core);
    const conversions = new Conversions(this.core);
    const cases = [];
    for (const part of parts) {
      for (const syntax of part.syntax.caseTypes.types) {
        const caseType = this.bindType(syntax, type.scopeFor(part));
        if (caseType.type.isErrorType()) continue;
        if (caseType.type.specialType === 'System_Void' || !conversions.classifyStandardImplicit(caseType.type, this.core.object).exists)
          this.unionDeclarationError(part, syntax, 'a union case type must convert to object');
        if (cases.some(other => conversions.isIdentity(other.type, caseType.type))) {
          this.unionDeclarationError(part, syntax, 'union case types must have distinct constructor signatures');
          continue;
        }
        cases.push(caseType);
        const constructor = caseConstructor(type, property, caseType, { part, syntax }, this.core);
        const conflict = members.find(member => member.kind === SymbolKind.Method && member.methodKind === MethodKind.Constructor &&
          member.parameters.length === 1 && conversions.isIdentity(member.parameters[0].type, caseType.type));
        if (conflict) this.unionDeclarationError(part, conflict.syntax ?? syntax, 'a member conflicts with a generated union constructor');
        members.push(constructor);
      }
    }
    const conflict = members.find(member => member.name === 'Value' || member.name === 'get_Value');
    if (conflict) this.unionDeclarationError(parts[0], conflict.syntax ?? parts[0].syntax.identifier, 'a member conflicts with the generated Value property');
    type.unionCaseTypes = cases;
    members.push(property);
  }
};
