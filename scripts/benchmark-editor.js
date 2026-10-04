import { benchmarkEditorModel } from './editor-benchmarks/model.js';
import { benchmarkEditorBrowser } from './editor-benchmarks/browser.js';
import { parseArguments, writeReport, isMain } from './editor-benchmarks/common.js';
export { benchmarkEditorModel, benchmarkEditorBrowser };

export async function runEditorBenchmark(options = {}) {
  const backend = options.backend ?? 'model';
  if (!['model', 'browser'].includes(backend)) throw new Error('Editor backend must be model or browser');
  return backend === 'browser' ? benchmarkEditorBrowser(options) : benchmarkEditorModel(options);
}

if (isMain(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const report = await runEditorBenchmark({ backend: args.backend ?? 'model',
    sizes: args.sizes?.split(',').map(Number), samples: args.samples === undefined ? 20 : Number(args.samples),
    warmups: args.warmups === undefined ? 3 : Number(args.warmups), browser: args.browser ?? 'chromium',
    executablePath: args.executable, onProgress: message => process.stderr.write(`${message}\n`) });
  if (args.output) await writeReport(args.output, report);
  else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
