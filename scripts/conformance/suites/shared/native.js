import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolveToolchain } from '../../oracle/toolchain.js';
import { runProcess } from '../../oracle/process.js';
import { parseDiagnostics } from '../../oracle/roslyn-compile.js';
import { root, json, sha256 } from './store.js';
export async function compileNative(row, options = {}) {
  const toolchain = await resolveToolchain(),
    directory = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-suite-'));
  try {
    const output = path.join(directory, 'Suite.dll');
    if (row.language === 'il') {
      const pins = await json(
        path.join(root, 'planning/qualification/suites/ilasm-pins.json'),
      );
      const rid =
        { darwin: 'osx', win32: 'win', linux: 'linux' }[process.platform] +
        '-' +
        process.arch;
      const pin = pins.platforms.find((value) => value.rid === rid),
        executable = process.env.SHARPFORGE_SUITE_ILASM;
      if (!pin || !executable)
        return {
          unsupported:
            'Pinned ILAsm 10.0.5 executable required via SHARPFORGE_SUITE_ILASM',
          toolchain,
        };
      if (sha256(await readFile(executable)) !== pin.sha256)
        throw Error('ILAsm executable hash mismatch');
      const source = path.join(directory, 'Suite.il');
      await writeFile(source, row.sourceText);
      const processResult = await runProcess(
        executable,
        [source, '/exe', `/output:${output}`],
        { cwd: directory, ...options },
      );
      if (processResult.exitCode !== 0)
        return {
          unsupported:
            'Upstream ILAsm input requires unsupported harness/preprocessor/references',
          diagnostics: [processResult.stderr, processResult.stdout],
          toolchain,
        };
      return {
        assembly: await readFile(output),
        diagnostics: [],
        toolchain,
        ilasm: pin,
      };
    }
    const source = path.join(directory, 'Suite.cs'),
      sarif = path.join(directory, 'diagnostics.json');
    await writeFile(source, '\uFEFF' + row.sourceText);
    const args = [
      toolchain.csc,
      '/nologo',
      '/noconfig',
      '/nostdlib+',
      '/utf8output',
      '/deterministic+',
      '/debug-',
      '/optimize+',
      '/nullable:disable',
      `/target:${row.target}`,
      `/langversion:${row.langVersion}`,
      `/out:${output}`,
      `/errorlog:${sarif},version=2.1`,
      ...toolchain.references.map((file) => `/reference:${file}`),
      source,
    ];
    const processResult = await runProcess(toolchain.dotnet, args, {
      cwd: directory,
      ...options,
    });
    if (processResult.signal || ![0, 1].includes(processResult.exitCode))
      throw Error('Native compiler host failure');
    let diagnostics;
    try {
      diagnostics = parseDiagnostics(
        JSON.parse(await readFile(sarif, 'utf8')),
        { source: 'Suite.cs' },
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return {
        unsupported:
          'Pinned compiler does not accept requested language/options',
        diagnostics: [processResult.stdout, processResult.stderr],
        toolchain,
      };
    }
    return {
      assembly: processResult.exitCode === 0 ? await readFile(output) : null,
      diagnostics: diagnostics.map((row) => ({
        code: row.id,
        severity: row.severity,
      })),
      toolchain,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
