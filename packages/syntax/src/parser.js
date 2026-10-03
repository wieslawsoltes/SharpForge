import { SourceText } from '@sharpforge/text';
import { lex } from './lexer.js';
import { Parser } from './parser/core.js';
import { typeMethods } from './parser/types.js';
import { declarationMethods } from './parser/declarations.js';
import { statementMethods } from './parser/statements.js';
import { expressionMethods } from './parser/expressions.js';
Object.assign(Parser.prototype, typeMethods, declarationMethods, statementMethods, expressionMethods);
export { Parser };
export function parse(source, cache) { return new Parser(lex(typeof source==='string'?new SourceText(source):source, cache)).parse(); }
export function parseExpression(text) { const p=new Parser(lex(new SourceText(text,'<expression>'))); const expression=p.expression();if(!p.at('eof'))p.error(p.current,'CS1003','Unexpected trailing input');return {expression,diagnostics:p.diagnostics}; }
export function walk(node, visit) { if(!node||typeof node!=='object')return; if(node.kind)visit(node);for(const [key,value] of Object.entries(node)){if(['source','tokens','nameSpan','symbol'].includes(key))continue;if(Array.isArray(value))for(const v of value)walk(v,visit);else if(value&&typeof value==='object')walk(value,visit);} }
