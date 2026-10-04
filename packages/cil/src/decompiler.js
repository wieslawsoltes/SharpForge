/** Conservative decompilation facade. Pipeline stages own decode orchestration and source reconstruction. */
export { decompileMethod, decompileAssembly } from './decompiler/pipeline.js';
export { buildControlFlowGraph, controlFlowGraphDiagnosticCatalog } from './decompiler/cfg.js';
