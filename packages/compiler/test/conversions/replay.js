/**
 * Replays the conversion corpus through SharpForge: binds the corpus source with the semantic analysis, takes the
 * corpus types from the parameters of `ConversionTypes<...>.Types` and the corpus expressions from the field
 * initializers of `ConversionExpressions`, and classifies every pair with conversions/classify.js the way the
 * Roslyn oracle does (the best conversion, implicit when one exists, otherwise explicit).
 *
 *   node packages/compiler/test/conversions/replay.js     prints every pair that differs from pinned.json
 */
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { SemanticAnalysis } from '../../src/semantic-analysis.js';
import { BodyBinder } from '../../src/binder/body-binder.js';
import { SymbolKind } from '../../src/symbols/types.js';
import { typesClass, expressionsClass } from './prelude.js';
import { loadCorpus, loadPinned } from './corpus.js';

const rowOf = conversion => [conversion.kind, conversion.exists, conversion.isImplicit, conversion.isExplicit];

/** Binds one corpus compilation. @returns {{ analysis, types, expressions }} bound types and raw bound expressions */
export function bindUnit(unit) {
  const options = unit.langVersion ? { languageVersion: unit.langVersion } : {};
  const file = parse(new SourceText(unit.source, 'Corpus.cs'), undefined, options);
  const analysis = new SemanticAnalysis([file], unit.langVersion ? { langVersion: unit.langVersion } : {});
  analysis.run();
  const named = name => analysis.assembly.types.find(type => type.name === name);
  const types = named(typesClass)
    .getMembers('Types')[0]
    .parameters.map(parameter => parameter.type);
  const holder = named(expressionsClass);
  const fields = holder.getMembers().filter(member => member.kind === SymbolKind.Field && member.initializerSyntax);
  const expressions = fields.map(field => {
    const binder = new BodyBinder(analysis, {
      uri: field.uri,
      scope: field.scope,
      containingType: holder,
      method: null,
      isStatic: true,
      isFieldInitializer: true,
      isStaticInitializer: true,
      parameters: [],
    });
    return binder.expression(field.initializerSyntax);
  });
  return { analysis, types, expressions };
}

/**
 * Classifies every pair of one compilation.
 * @returns {{ typePairs: any[][], expressions: any[][], unmodelled: string[] }} rows `[kind, exists, isImplicit,
 *   isExplicit]` in corpus order, and the corpus types SharpForge could not bind
 */
export function replayUnit(unit) {
  const { analysis, types, expressions } = bindUnit(unit);
  const conversions = analysis.conversions;
  const unmodelled = unit.types.filter((text, index) => !types[index] || types[index].isErrorType());
  const typePairs = unit.typePairs.map(pair => rowOf(conversions.classifyExplicit(types[pair.from], types[pair.to])));
  const expressionRows = unit.expressions.map((pair, index) => rowOf(conversions.classifyCastFromExpression(expressions[index], types[pair.to])));
  return { typePairs, expressions: expressionRows, unmodelled };
}

/** Every pair whose SharpForge classification differs from the pinned Roslyn one. */
export function mismatches(corpus = loadCorpus(), pinned = loadPinned()) {
  const found = [];
  corpus.forEach((unit, unitIndex) => {
    const expected = pinned.compilations[unitIndex];
    const actual = replayUnit(unit);
    for (const text of actual.unmodelled) found.push({ unit: unitIndex, unmodelled: text });
    for (const [list, kind] of [
      ['typePairs', 'type'],
      ['expressions', 'expression'],
    ]) {
      unit[list].forEach((pair, index) => {
        const want = expected[list][index].slice(2);
        const got = actual[list][index];
        if (JSON.stringify(want) !== JSON.stringify(got)) {
          found.push({ unit: unitIndex, kind, category: pair.category, source: pair.source, target: pair.target, want, got });
        }
      });
    }
  });
  return found;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const found = mismatches();
  for (const row of found) {
    if (row.unmodelled) console.log(`unmodelled type: ${row.unmodelled}`);
    else console.log(`${row.kind.padEnd(10)} ${row.source} -> ${row.target}: Roslyn ${row.want.join(' ')} | SharpForge ${row.got.join(' ')}`);
  }
  console.log(`${found.length} mismatches`);
}
