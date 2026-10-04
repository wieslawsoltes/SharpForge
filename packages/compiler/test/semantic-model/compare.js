/**
 * Compares the answers of the semantic model over the semantic analysis with the pinned Roslyn answers (SF-A02-T38).
 *
 * Each Roslyn row asks up to four questions about one span: the symbol, the type, the converted type and the
 * constant value (a declaration row asks for the declared symbol). An answer is
 *   'same'      the model says what Roslyn says,
 *   'different' the model says something else,
 *   'none'      the model has no answer where Roslyn has one.
 * Questions Roslyn answers with a symbol the model does not have by design are not asked (`notAsked`):
 *   - the operator method of a built-in operator (`int.operator +(int, int)`): built-in operators have no symbol here;
 *   - the anonymous function symbol of a lambda, and `this` as a parameter.
 */
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { AnalysisModel } from '../../src/semantic/analysis-model.js';
import { SymbolKind } from '../../src/symbols/types.js';

/** Symbol kinds whose full display text is compared; for the others (locals, parameters, ...) kind and name are. */
const displayedKinds = new Set(['Method', 'NamedType', 'Field', 'Property', 'Event', 'Namespace']);
const roslynKind = symbol => (symbol.kind === SymbolKind.ErrorType ? 'ErrorType' : symbol.kind);

/** The model of a pinned program. */
export function modelOf(program) {
  const file = parse(new SourceText(program.source, 'Program.cs'));
  return new AnalysisModel([file], program.langVersion ? { langVersion: program.langVersion } : {});
}

const notAskedMethodKinds = new Set(['BuiltinOperator', 'AnonymousFunction', 'LambdaMethod']);
const isNotAsked = row => notAskedMethodKinds.has(row.methodKind) || (row.symbolKind === 'Parameter' && row.name === 'this');

function sameSymbol(symbol, row) {
  if (roslynKind(symbol) !== row.symbolKind) return false;
  if (displayedKinds.has(row.symbolKind)) return symbol.toDisplayString() === row.display;
  return symbol.name === row.name;
}

function constantText(value) {
  if (value === null || value === undefined) return null;
  return typeof value === 'boolean' || typeof value === 'string' ? value : String(value);
}

function sameConstant(ours, theirs) {
  if (!ours.hasValue) return false;
  const a = constantText(ours.value),
    b = theirs.value;
  if (a === b) return true;
  return typeof a === 'string' && typeof b === 'string' && a !== '' && b !== '' && Number(a) === Number(b);
}

/**
 * Asks the model every pinned question of one program.
 * @returns {{asked:number, same:number, none:object[], different:object[], notAsked:number}} `none` and `different`
 *   hold `{question, start, end, syntaxKind, expected, actual}`
 */
export function compareProgram(program, pinned) {
  const model = modelOf(program),
    result = { asked: 0, same: 0, none: [], different: [], notAsked: 0 };
  const record = (question, row, expected, actual, verdict) => {
    result.asked++;
    if (verdict === 'same') result.same++;
    else result[verdict].push({ question, start: row.start, end: row.end, syntaxKind: row.syntaxKind, expected, actual });
  };
  const display = type => type?.toDisplayString() ?? null;
  for (const row of pinned.expressions) {
    const span = { start: row.start, end: row.end },
      symbol = model.getSymbolInfo(span).symbol,
      types = model.getTypeInfo(span);
    if (isNotAsked(row)) result.notAsked++;
    else if (row.symbolKind || symbol) {
      const verdict = !symbol ? 'none' : row.symbolKind && sameSymbol(symbol, row) ? 'same' : 'different';
      const expected = row.symbolKind ? `${row.symbolKind} ${row.display}` : null;
      record('symbol', row, expected, symbol ? `${roslynKind(symbol)} ${symbol.toDisplayString()}` : null, verdict);
    }
    for (const [question, expected, actual] of [
      ['type', row.type, display(types.type)],
      ['convertedType', row.convertedType, display(types.convertedType)],
    ]) {
      if (expected === null && actual === null) continue;
      record(question, row, expected, actual, actual === null ? 'none' : actual === expected ? 'same' : 'different');
    }
    const constant = model.getConstantValue(span);
    if (row.constant || constant.hasValue) {
      const verdict = !constant.hasValue ? 'none' : row.constant && sameConstant(constant, row.constant) ? 'same' : 'different';
      record('constant', row, row.constant?.value ?? null, constant.hasValue ? constantText(constant.value) : null, verdict);
    }
  }
  for (const row of pinned.declarations) {
    const symbol = model.getDeclaredSymbol({ start: row.start, end: row.end });
    const verdict = !symbol ? 'none' : sameSymbol(symbol, row) ? 'same' : 'different';
    record('declared', row, `${row.symbolKind} ${row.display}`, symbol ? `${roslynKind(symbol)} ${symbol.toDisplayString()}` : null, verdict);
  }
  return result;
}
