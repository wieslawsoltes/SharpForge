import { benchmarkEditorMemory } from './editor-benchmarks/memory.js';
import { parseArguments, writeReport, isMain } from './editor-benchmarks/common.js';
export { benchmarkEditorMemory };

if (isMain(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const report = await benchmarkEditorMemory({ sizes: args.sizes?.split(',').map(Number),
    undoSteps: args['undo-steps'] === undefined ? 100 : Number(args['undo-steps']), onProgress: message => process.stderr.write(`${message}\n`) });
  if (args.output) await writeReport(args.output, report);
  else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.correctness.passed) process.exitCode = 1;
}
