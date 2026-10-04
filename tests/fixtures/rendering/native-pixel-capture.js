import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const processResult = Object.freeze({ exitCode: 0, signal: null, stdout: '', stderr: '', elapsedMs: 1 });

/** A protocol-only executable double. Its bytes are test inputs and are never checked in as native goldens. */
export function fakeNativePixels({ changeSecond = false, corruptHash = false, stderr = '', onRestore } = {}) {
  const calls = [];
  let captures = 0;
  async function execute(command, args, options) {
    calls.push({ command, args, options });
    if (args[0] === 'restore') {
      onRestore?.();
      return processResult;
    }
    if (args[0] === 'build') {
      const output = args[args.indexOf('-o') + 1];
      await mkdir(output);
      await writeFile(path.join(output, 'Oracle.WinUI.exe'), 'Protocol fixture only; never executed');
      return processResult;
    }
    captures++;
    const input = JSON.parse(await readFile(args[0], 'utf8'));
    const observations = [];
    for (const fixture of input.fixtures) {
      if (fixture.expected === 'load-error') {
        observations.push({ id: fixture.id, status: 'load-error', xamlSha256: fixture.xamlSha256,
          exception: 'FixtureOnly.XamlParseException', hresult: -1 });
        continue;
      }
      const dimensions = [Math.ceil(fixture.width * fixture.dpr), Math.ceil(fixture.height * fixture.dpr)];
      const bytes = new Uint8Array(dimensions[0] * dimensions[1] * 4);
      bytes.set(changeSecond && captures === 2 ? [3, 2, 1, 255] : [1, 2, 3, 255]);
      const file = fixture.id + '.bgra';
      await writeFile(path.join(args[1], file), bytes);
      observations.push({ id: fixture.id, status: 'pixels', xamlSha256: fixture.xamlSha256, file, dimensions,
        byteCount: bytes.length, bgraSha256: corruptHash ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex'),
        pixelFormat: 'BGRA8', alphaMode: 'premultiplied', colorSpace: 'srgb', origin: 'top-left',
        rasterizationScale: 1.25, rasterScaleMode: 'render-target-explicit-size', actualTheme: fixture.theme,
        focusTarget: fixture.focusTarget ?? null });
    }
    await writeFile(path.join(args[1], 'native.json'), JSON.stringify({ schemaVersion: 1, inputHash: input.inputHash,
      runtime: input.runtime, culture: 'en-US', toolVersion: 'fixture-only-never-executed',
      operatingSystem: { description: 'Protocol fixture, not Windows evidence', architecture: 'X64' },
      environment: { highContrast: false, animationsEnabled: true, textScaleFactor: 1 },
      stabilityPolicy: { consecutiveCaptures: 3, maximumRenderingTurns: 120 }, observations }));
    return { ...processResult, stderr };
  }
  return { execute, calls };
}
