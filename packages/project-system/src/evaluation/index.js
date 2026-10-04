import { parseXml } from '../xml.js';
import { EvaluationContext } from './context.js';
import { evaluateImports } from './imports.js';
import { evaluateDefinitions } from './properties.js';
import { evaluateItems } from './items.js';
import { evaluationResult } from './result.js';

/** Evaluate a data-only project with explicit phases; no target tasks execute while loading. */
export function evaluatePortableProject(system, path) {
  const root = parseXml(system.text(path));
  if (root.name !== 'Project') throw new Error(`Expected <Project> in ${path}`);
  const context = new EvaluationContext(system, path, root);
  evaluateImports(context, root);
  evaluateDefinitions(context);
  evaluateItems(context);
  context.evaluationDiagnostics = system.diagnostics.map(diagnostic => ({...diagnostic}));
  const project = evaluationResult(context, root);
  system.evaluationContexts?.set(path, context);
  return project;
}
