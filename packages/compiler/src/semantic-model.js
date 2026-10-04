/**
 * The semantic model: the query surface language services use to ask what a piece of syntax means (SF-A02-T38).
 *
 *   getSymbolInfo(node)      the symbol an expression or name refers to
 *   getTypeInfo(node)        the type of an expression and the type it converts to
 *   getConversion(node)      the implicit conversion applied to an expression
 *   getDeclaredSymbol(node)  the symbol a declaration introduces
 *   getConstantValue(node)   the compile-time constant value of an expression
 *   getDiagnostics(span?)    the diagnostics of the program, optionally those that overlap a span
 *   lookupSymbols(position)  the symbols in scope at a position, optionally by name
 *   bindSpeculativeExpression(position, text)  binds an expression that is not in the source, in the scope at a position
 *   analyzeDataFlow / analyzeControlFlow       region analysis for refactorings
 *
 * There are two binders, and the model answers from the one that bound the program:
 *
 *   - A program the execution profile compiles by itself is answered from the execution binder
 *     (semantic/execution-model.js), as before.
 *   - Every other program - one that uses structs, interfaces, generics, inheritance, ... or one that has errors - is
 *     answered from the semantic analysis (semantic/analysis-model.js). `{ semantic: true }` asks for that model for
 *     any program; it is the one whose answers are pinned against Roslyn.
 *
 * Both answer the same queries with the same result shapes. A node is a node of the tree the compilation was built
 * from, a node of the lossless tree, or any `{start, end, uri?}`: the semantic analysis finds what it bound by span.
 */
import { parseCompilerInput } from './parse-input.js';
import { Compilation } from './compilation.js';
import { ExecutionSemanticModel } from './semantic/execution-model.js';
import { AnalysisModel } from './semantic/analysis-model.js';
import { Conversion, ConversionKind } from './conversions/classify.js';

const identity = new Conversion(ConversionKind.Identity);

export class SemanticModel extends ExecutionSemanticModel {
  /**
   * @param compilation a built Compilation
   * @param {{semantic?: boolean}} [options] `semantic: true` answers from the semantic analysis; otherwise the
   *   compilation must have been built with the bound pipeline
   */
  constructor(compilation, { semantic = false } = {}) {
    // The execution model reads the bound pipeline; a compilation without one can only be answered by the analysis.
    super(semantic && !compilation.boundPipeline ? Object.assign(Object.create(compilation), { boundPipeline: { units: [] } }) : compilation);
    this.compilation = compilation;
    this.analysisModel = semantic ? new AnalysisModel(compilation.inputFiles, compilation.options) : null;
  }
  /** True when the answers come from the semantic analysis. */
  get isSemantic() {
    return this.analysisModel !== null;
  }
  /**
   * Compiles `input` (source text or `{uri,text}` files) and returns `{model, result, compilation}`. The model is
   * built over the semantic analysis when the execution profile did not compile the program by itself, or when
   * `options.semantic` is true.
   */
  static create(input, options = {}) {
    const { semantic: requested, ...compilerOptions } = options,
      compilation = new Compilation(parseCompilerInput(input, compilerOptions), { ...compilerOptions, pipeline: 'bound' }),
      result = compilation.build(),
      decidedByAnalysis = !!result.semantic && (!!result.semantic.generated || !result.success),
      model = new SemanticModel(compilation, { semantic: requested ?? decidedByAnalysis });
    return { model, result, compilation };
  }
  /** The implicit conversion applied to an expression where it is used (the identity conversion when there is none). */
  getConversion(node) {
    return this.analysisModel ? this.analysisModel.getConversion(node) : identity;
  }
  /** The diagnostics of the program; with `{start, end, uri?}`, those that overlap that span. */
  getDiagnostics(span = null) {
    if (this.analysisModel) return this.analysisModel.getDiagnostics(span);
    const all = this.compilation.diagnostics,
      uri = span?.uri ?? this.compilation.files[0]?.source.uri;
    return span ? all.filter(d => d.uri === uri && d.start < span.end && span.start < d.start + Math.max(1, d.length)) : [...all];
  }
  /** Flow analysis results of the execution binder for the method at a position; null for the semantic analysis. */
  getFlowAnalysis(position, uri) {
    return this.analysisModel ? null : super.getFlowAnalysis(position, uri);
  }
  // ---- the queries both models answer: the semantic analysis answers them when the model is built over it ----
  getBoundNode(node) {
    return this.analysisModel ? this.analysisModel.getBoundNode(node) : super.getBoundNode(node);
  }
  getSymbolInfo(node) {
    return this.analysisModel ? this.analysisModel.getSymbolInfo(node) : super.getSymbolInfo(node);
  }
  getTypeInfo(node) {
    return this.analysisModel ? this.analysisModel.getTypeInfo(node) : super.getTypeInfo(node);
  }
  getConstantValue(node) {
    return this.analysisModel ? this.analysisModel.getConstantValue(node) : super.getConstantValue(node);
  }
  getDeclaredSymbol(node) {
    return this.analysisModel ? this.analysisModel.getDeclaredSymbol(node) : super.getDeclaredSymbol(node);
  }
  lookupSymbols(position, options) {
    return this.analysisModel ? this.analysisModel.lookupSymbols(position, options) : super.lookupSymbols(position, options);
  }
  bindSpeculativeExpression(position, expression, options) {
    if (!this.analysisModel) return super.bindSpeculativeExpression(position, expression, options);
    return this.analysisModel.bindSpeculativeExpression(position, expression, options);
  }
  getSpeculativeTypeInfo(position, expression, options) {
    if (!this.analysisModel) return super.getSpeculativeTypeInfo(position, expression, options);
    return this.analysisModel.getSpeculativeTypeInfo(position, expression, options);
  }
  analyzeDataFlow(start, end, options) {
    return this.analysisModel ? this.analysisModel.analyzeDataFlow(start, end, options) : super.analyzeDataFlow(start, end, options);
  }
  analyzeControlFlow(start, end, options) {
    return this.analysisModel ? this.analysisModel.analyzeControlFlow(start, end, options) : super.analyzeControlFlow(start, end, options);
  }
}

