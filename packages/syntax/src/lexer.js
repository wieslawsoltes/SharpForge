/** Lexer entry point; the scanner is split into modules under ./lexer and ./directives. */
export * from './lexer/scanner.js';
export * from './lexer/keywords.js';
export * from './lexer/operators.js';
export * from './lexer/escapes.js';
export * from './lexer/numbers.js';
export * from './lexer/reals.js';
export * from './lexer/strings.js';
export * from './lexer/raw-strings.js';
export * from './lexer/utf8-suffix.js';
export * from './lexer/identifiers.js';
export * from './lexer/trivia.js';
export * from './directives/conditional.js';
export * from './directives/misc.js';
export * from './directives/script.js';
export * from './interpolation.js';
