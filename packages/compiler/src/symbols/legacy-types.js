import {ArrayTypeSymbol,ErrorTypeSymbol,TypeSymbol} from './types.js';
/**
 * Adapter between the string type names of the string-typed profile and type symbols.
 *
 * The string-typed call sites (the declaration pass, the framework registry, the bytecode image) keep exchanging
 * names such as 'int', 'Foo', 'int[]' or "System.Collections.Generic.List`1<int>". `LegacyTypeAdapter.symbol`
 * turns such a name into the one TypeSymbol that stands for it in a compilation; `name` goes back.
 * Pseudo types: 'null' (the null literal has no type) maps to JS null, 'error' to ErrorTypeSymbol.unknown.
 */
export class LegacyTypeAdapter {
  /**
   * @param {object} options `bridge`: the RegistryBridge that owns special and framework types;
   *   `sourceType(name)`: resolves a user type's image name to its source NamedTypeSymbol (or null).
   */
  constructor({bridge,sourceType=()=>null}){this.bridge=bridge;this.sourceType=sourceType;this.symbols=new Map();this.names=new Map();}
  /** The symbol for a legacy type name. Equal names yield the identical symbol. */
  symbol(name){
    if(name instanceof TypeSymbol||name===null)return name;if(name===undefined||name==='null')return null;if(this.symbols.has(name))return this.symbols.get(name);
    let type;
    if(name==='error')type=ErrorTypeSymbol.unknown;
    else if(name.endsWith('[]')){const element=this.symbol(name.slice(0,-2));type=new ArrayTypeSymbol(element??ErrorTypeSymbol.unknown,1,{baseType:()=>this.bridge.typeProvider.getCoreTypeQuiet('System_Array')});}
    else type=this.sourceType(name)??this.bridge.typeFromName(name)??new ErrorTypeSymbol(name);
    this.symbols.set(name,type);if(!this.names.has(type))this.names.set(type,name);return type;
  }
  /** The legacy name of a symbol: the name it was created from, else derived structurally. */
  name(type){
    if(type===null||type===undefined)return 'null';if(typeof type==='string')return type;const known=this.names.get(type);if(known!==undefined)return known;
    if(type instanceof ArrayTypeSymbol)return this.name(type.elementType)+'[]';if(type instanceof ErrorTypeSymbol)return type.name||'error';
    return this.bridge.registryName(type)??type.legacyName??type.name;
  }
  /** Declares the source symbol that a user type name stands for (called by the declaration pass). */
  define(name,type){this.symbols.set(name,type);this.names.set(type,name);return type;}
}
