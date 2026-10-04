import {NamedTypeSymbol,Accessibility,TypeKind} from './types.js';
import {MethodSymbol,FieldSymbol,PropertySymbol,ParameterSymbol,MethodKind,modifiersFromSyntax,accessibilityFromSyntax,DeclarationModifiers} from './members.js';
import {NamespaceSymbol,NamespaceExtent,mergeGlobalNamespaces} from './namespaces.js';
import {frameworkBridge} from './registry-bridge.js';
import {LegacyTypeAdapter} from './legacy-types.js';
import {FrameworkMembers} from '../binder/framework-members.js';
/**
 * The symbols of one compilation: source symbols for the declaration records the Compilation builds
 * (types, fields, properties, methods - including synthesized ones), the framework symbols from the registry
 * bridge, the merged global namespace, and the adapter between string type names and type symbols.
 *
 * Every source symbol carries `legacy`, the declaration record it stands for, so code generation can reach
 * the image ids and slot indices that the bytecode back end needs.
 */
export class CompilationSymbols {
  constructor(compilation){
    this.compilation=compilation;this.bridge=frameworkBridge();this.module=Object.freeze({name:compilation.options?.name??'Application',kind:'source'});
    this.sourceNamespace=new NamespaceSymbol('',null,NamespaceExtent.Source,this.module);this.globalNamespace=mergeGlobalNamespaces(this.sourceNamespace,this.bridge.globalNamespace);
    this.types=new LegacyTypeAdapter({bridge:this.bridge,sourceType:name=>{const record=compilation.typeMap.get(name);return record?this.type(record):null;}});this.records=new Map();
    this.framework=new FrameworkMembers({bridge:this.bridge,typeOf:name=>this.typeOf(name)});
  }
  get typeProvider(){return this.bridge.typeProvider;}
  /** The TypeSymbol for a legacy type name ('int', 'Foo[]', ...); null for 'null'. */
  typeOf(name){return this.types.symbol(name);}
  /** The legacy name of a TypeSymbol. */
  nameOf(type){return this.types.name(type);}
  /** The source type symbol of a type declaration record. */
  type(record){
    let symbol=this.records.get(record);if(symbol)return symbol;const node=record.node,modifiers=record.declarations.flatMap(d=>d.modifiers??[]);
    symbol=new NamedTypeSymbol({name:node.name,typeKind:TypeKind.Class,declaredAccessibility:accessibilityFromSyntax(modifiers,Accessibility.Internal),isStatic:modifiers.includes('static'),isSealed:modifiers.includes('sealed'),isAbstract:modifiers.includes('abstract'),
      baseType:()=>this.bridge.objectType,interfaces:()=>record.interfaces.map(i=>this.typeOf(i)).filter(t=>t&&!t.isErrorType()),members:()=>[...record.fields.map(f=>this.field(f)),...record.properties.map(p=>this.property(p)),...record.methods.map(m=>this.method(m))],
      locations:record.declarations.map(d=>({uri:d.uri,start:d.nameSpan?.start??d.start,end:d.nameSpan?.end??d.end})),isImplicitlyDeclared:!!node.generated});
    symbol.legacy=record;symbol.legacyName=record.name;symbol.syntax=node;this.records.set(record,symbol);this.sourceNamespace.ensureNamespace(node.namespace??'').addType(symbol);return symbol;
  }
  location(node){return node?.uri===undefined?[]:[{uri:node.uri,start:node.nameSpan?.start??node.start,end:node.nameSpan?.end??node.end}];}
  field(record){
    let symbol=this.records.get(record);if(symbol)return symbol;const modifiers=record.node.modifiers??[];
    symbol=new FieldSymbol({name:record.name,type:this.typeOf(record.type),containingSymbol:this.type(record.owner),declaredAccessibility:accessibilityFromSyntax(modifiers),modifiers:modifiersFromSyntax(modifiers)|(record.isStatic?DeclarationModifiers.Static:0),locations:this.location(record.node),syntax:record.node,isImplicitlyDeclared:!!record.backing});
    symbol.legacy=record;this.records.set(record,symbol);return symbol;
  }
  property(record){
    let symbol=this.records.get(record);if(symbol)return symbol;const modifiers=record.node.modifiers??[];
    symbol=new PropertySymbol({name:record.name,type:this.typeOf(record.type),containingSymbol:this.type(record.owner),declaredAccessibility:accessibilityFromSyntax(modifiers),modifiers:modifiersFromSyntax(modifiers),locations:this.location(record.node),syntax:record.node});
    symbol.legacy=record;this.records.set(record,symbol);symbol.getMethod=record.get?this.method(record.get):null;symbol.setMethod=record.set?this.method(record.set):null;symbol.backingField=record.backing?this.field(record.backing):null;if(symbol.backingField)symbol.backingField.associatedSymbol=symbol;return symbol;
  }
  method(record){
    let symbol=this.records.get(record);if(symbol)return symbol;const modifiers=record.node?.modifiers??[],kind=record.accessor?(record.accessor.kind==='get'?MethodKind.PropertyGet:MethodKind.PropertySet):record.name==='.ctor'?MethodKind.Constructor:record.name==='.cctor'?MethodKind.StaticConstructor:MethodKind.Ordinary;
    symbol=new MethodSymbol({name:record.name,methodKind:kind,returnType:this.typeOf(record.returnType),parameters:record.parameters.map((p,i)=>{const parameter=new ParameterSymbol({name:p.name,type:this.typeOf(p.type),ordinal:i,locations:this.location(p),syntax:p});parameter.legacyType=p.type;return parameter;}),
      containingSymbol:record.owner?this.type(record.owner):this.sourceNamespace,declaredAccessibility:record.accessor?accessibilityFromSyntax([record.accessor.access]):accessibilityFromSyntax(modifiers),modifiers:modifiersFromSyntax(modifiers)|(record.isStatic?DeclarationModifiers.Static:0),locations:this.location(record.node),syntax:record.node,isImplicitlyDeclared:!!record.synthetic});
    symbol.legacy=record;this.records.set(record,symbol);if(record.accessor){const property=record.owner.properties.find(p=>p[record.accessor.kind]===record);if(property)symbol.associatedSymbol=this.property(property);}return symbol;
  }
  /** The source symbol for any declaration record. */
  symbolFor(record){return this.records.get(record)??(record.declarations?this.type(record):record.accessors!==undefined||record.get!==undefined?this.property(record):record.parameters?this.method(record):this.field(record));}
  /** Framework member symbols. */
  contract(contract){return contract?this.bridge.symbolForContract(contract):null;}
  builtin(builtin){return builtin?this.bridge.symbolForBuiltin(builtin):null;}
}
