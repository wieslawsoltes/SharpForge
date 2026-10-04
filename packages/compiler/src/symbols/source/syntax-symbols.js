/**
 * Source symbols built from the lossless syntax tree: every declaration form the parser accepts - namespaces,
 * classes, structs, interfaces, enums, delegates, records, nested and generic types, fields, methods,
 * constructors, properties, indexers, events, operators and conversions - becomes a symbol of the model in
 * ../types.js and ../members.js. Types are declared eagerly (name, arity, container); base types, interfaces and
 * members are bound on first use, so declaration order and cross-file references do not matter.
 *
 * Reports CS0101/CS0260/CS0262 (duplicate and partial types), CS0102/CS0111 (duplicate members), CS0542 (member
 * named like its type), CS0100 (duplicate parameter) and the modifier checks a declaration alone decides.
 *
 * The assembly is one class composed from the builders in this directory.
 */
import { SourceAssemblyCore } from './assembly-core.js';
import { MemberSymbolBuilder } from './member-symbols.js';
import { PropertySymbolBuilder } from './property-symbols.js';
import { MemberConflicts } from './member-conflicts.js';
import { CompoundOperatorSymbols } from './compound-operators.js';
import { FieldKeywordSymbols } from './field-keyword.js';
import { ExtensionBlockBuilder } from './extension-blocks.js';
import { UnionSymbolBuilder } from '../synthesized/unions.js';

const builders = [
  MemberSymbolBuilder,
  PropertySymbolBuilder,
  FieldKeywordSymbols,
  MemberConflicts,
  ExtensionBlockBuilder,
  CompoundOperatorSymbols,
  UnionSymbolBuilder,
];

/**
 * `new SourceAssembly(files, host).declare(mergedGlobalNamespace)`.
 * `host`: `{ core, typeBinder, report(uri, node, code, args), resolveBases(type), name? }`.
 */
export class SourceAssembly extends builders.reduce((composed, builder) => builder(composed), SourceAssemblyCore) {}

export { SourceTypeSymbol, isTypeDeclaration } from './source-type.js';
