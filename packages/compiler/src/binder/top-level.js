/**
 * Top-level statements (SF-A02-T70, C# 9). The statements of a compilation unit are the body of the synthesized
 * entry point `Program.<Main>$(string[] args)`: `args` is its parameter, `await` makes it asynchronous and
 * `return value;` gives the exit code. Local functions among the statements are local functions of that method.
 *
 * Rules checked here (Roslyn):
 *   CS8803  a top-level statement after a namespace or type declaration (reported once per file, at the first one)
 *   CS8937  every top-level statement of the file is empty
 *   CS8801  a type of the file uses a local or local function of the top-level statements
 *   CS0260  `class Program` is declared without `partial` next to the synthesized one; CS0101 when it is not a class
 *   CS8802  a second compilation unit with top-level statements; CS8805 top-level statements in a library
 * The entry-point selection (binder/entry-point.js) reports CS7022 (a Main method that is ignored). The pinned Roslyn
 * no longer rejects a main-type option next to top-level statements.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind, RefKind, Accessibility, NamedTypeSymbol } from '../symbols/types.js';
import { BodyBinder } from './body-binder.js';
import { analyzeDefiniteAssignment } from '../flow/semantic-assignment.js';
import { analyzeRefSafety } from '../flow/ref-safety.js';
import { NullableWalker } from '../nullable/walker.js';
import { containsAwait } from '../semantic/analysis-helpers.js';
import { topLevelProgramTypeName } from '../lowering/generated-names.js';

const isStatement = member => member.kind === 'GlobalStatement';

/** The top-level statements of a parsed file, in order. */
export const topLevelStatementsOf = file => file.syntax.members.filter(isStatement).map(member => member.statement);

/**
 * Placement rules of the top-level statements of one file.
 * @returns {{node:object,code:string,args:string[]}[]}
 */
export function checkTopLevelPlacement(file) {
  const rows = [],
    members = file.syntax.members,
    statements = topLevelStatementsOf(file);
  if (!statements.length) return rows;
  const firstDeclaration = members.findIndex(member => !isStatement(member) && member.kind !== 'IncompleteMember'),
    misplaced = firstDeclaration < 0 ? null : members.slice(firstDeclaration).find(isStatement);
  if (misplaced) rows.push({ node: misplaced.statement, code: DiagnosticId.CS8803, args: [] });
  if (statements.every(statement => statement.kind === 'EmptyStatement')) rows.push({ node: statements[0], code: DiagnosticId.CS8937, args: [] });
  return rows;
}

/**
 * The first top-level statement of a parsed file that follows a namespace or type declaration (CS8803), or null.
 * The compilation reports it on every compile path: the execution pipeline runs the statements wherever they stand.
 */
export function misplacedTopLevelStatement(file) {
  if (!file.syntax?.members) return null;
  return checkTopLevelPlacement(file).find(row => row.code === DiagnosticId.CS8803)?.node ?? null;
}

/** The names the top-level statements of a file declare at their outermost level: locals and local functions. */
export function topLevelNamesOf(file) {
  const names = new Set();
  for (const statement of topLevelStatementsOf(file)) {
    if (statement.kind === 'LocalFunctionStatement') names.add(statement.identifier.valueText);
    else if (statement.kind === 'LocalDeclarationStatement')
      for (const variable of statement.declaration.variables) names.add(variable.identifier.valueText);
  }
  return names;
}

/** True when a top-level local function is named nowhere else in the file: it is unused (CS8321). */
function hasUnusedLocalFunction(file) {
  const text = file.source.text;
  return topLevelStatementsOf(file).some(statement => {
    if (statement.kind !== 'LocalFunctionStatement') return false;
    const name = statement.identifier.valueText,
      first = text.indexOf(name);
    return text.indexOf(name, first + name.length) < 0;
  });
}

/**
 * True when a file that the execution pipeline compiles needs the rules above: the pipeline runs the statements
 * without checking where they stand, what `Program` is or that `args` is already a name.
 */
export function needsTopLevelRules(file) {
  const members = file.syntax?.members ?? [];
  if (!members.some(isStatement)) return false;
  return (
    topLevelStatementsOf(file).every(statement => statement.kind === 'EmptyStatement') ||
    topLevelNamesOf(file).has('args') ||
    hasUnusedLocalFunction(file) ||
    members.some(member => member.identifier?.valueText === topLevelProgramTypeName() && /Declaration$/.test(member.kind))
  );
}

/** Class mixin (analysis phase): binds the top-level statements of each file and checks their rules. */
export const TopLevelPrograms = Base =>
  class extends Base {
    /** The names declared by the top-level statements of the file `uri` (for CS8801). */
    topLevelNames(uri) {
      this.topLevelNamesByUri ??= new Map(this.files.map(file => [file.source.uri, topLevelNamesOf(file)]));
      return this.topLevelNamesByUri.get(uri) ?? new Set();
    }
    /**
     * The class that holds `<Main>$`: the user's `partial class Program` when there is one (its static members are in
     * scope in the statements), else a synthesized `Program`. Any other declaration of that name conflicts with it.
     */
    programTypeOf(firstStatement, uri) {
      if (this.programType) return this.programType;
      const name = topLevelProgramTypeName(),
        declared = this.assembly.globalNamespace.getTypeMembers(name, 0).find(type => type.isSource);
      if (declared && declared.typeKind !== TypeKind.Class)
        this.report(uri, firstStatement.firstToken(), DiagnosticId.CS0101, ['<global namespace>', name]);
      else if (declared) {
        const isPartial = declaration => [...declaration.syntax.modifiers].some(token => token.text === 'partial');
        for (const declaration of declared.declarations.filter(d => !isPartial(d)))
          this.report(declaration.uri, declaration.syntax.identifier, DiagnosticId.CS0260, [name]);
        return (this.programType = declared);
      }
      this.programType = Object.assign(
        new NamedTypeSymbol({
          name,
          typeKind: TypeKind.Class,
          containingSymbol: this.assembly.globalNamespace,
          declaredAccessibility: Accessibility.Internal,
          baseType: () => this.core.object,
          isImplicitlyDeclared: true,
        }),
        { isSource: true },
      );
      return this.programType;
    }
    /** Top-level statements are the body of the synthesized `<Main>$`; top-level methods become its local functions. */
    bindTopLevel() {
      const byFile = new Map();
      for (const item of this.assembly.topLevel) {
        if (!byFile.has(item.file)) byFile.set(item.file, []);
        byFile.get(item.file).push(item);
      }
      let units = 0;
      for (const [file, items] of byFile) {
        const statements = items.filter(i => i.statement).map(i => i.statement);
        if (!statements.length) continue;
        const uri = file.source.uri;
        if (units++) this.report(uri, statements[0].firstToken(), DiagnosticId.CS8802);
        else if (this.options.outputKind === 'library') this.report(uri, statements[0].firstToken(), DiagnosticId.CS8805);
        for (const row of checkTopLevelPlacement(file)) this.report(uri, row.node, row.code, row.args);
        const binder = new BodyBinder(this, {
          uri,
          scope: items[0].scope,
          containingType: this.programTypeOf(statements[0], uri),
          method: null,
          isStatic: true,
          isFieldInitializer: false,
          isTopLevel: true,
          isAsync: statements.some(s => containsAwait(s)),
          returnType: null,
          parameters: [
            {
              name: 'args',
              kind: SymbolKind.Parameter,
              type: this.core.arrayOf(this.core.string),
              refKind: RefKind.None,
              isImplicitlyDeclared: true,
            },
          ],
        });
        const body = binder.block({ statements, span: file.syntax.span, kind: 'Block' }, { statements });
        body.locals = binder.locals;
        body.binder = binder;
        this.bound.set(file, body);
        this.analyzeTopLevelFlow(uri, body);
      }
    }
    analyzeTopLevelFlow(uri, body) {
      const options = { core: this.core, languageVersion: this.versionOf(uri).number, containingType: null };
      for (const d of analyzeDefiniteAssignment(null, body, options)) this.report(uri, d.node, d.code, d.args);
      for (const d of analyzeRefSafety(null, body)) this.report(uri, d.node, d.code, d.args);
      if (this.nullableMaps.get(uri)?.anyWarnings ?? this.nullableAt(uri, 0).warnings)
        for (const d of new NullableWalker(this, uri).analyze(null, body)) this.report(uri, d.node, d.code, d.args, 'warning');
    }
  };
