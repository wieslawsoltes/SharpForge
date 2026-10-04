import { CONTROL_BYTES, MAX_SEEDS, PROTOCOL, normalizeBudgets, validateTargetId } from './budgets.js';

const send = message => process.stdout.write(JSON.stringify(message) + '\n');

async function readRequest() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > CONTROL_BYTES) throw new RangeError('Fixture request exceeds control limit');
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (request.protocol !== PROTOCOL || !['run', 'seeds'].includes(request.mode)) throw new Error('Invalid fixture request');
  validateTargetId(request.targetId, request.selfTest ?? false);
  return { ...request, budgets: normalizeBudgets(request.budgets) };
}

function decodeInput(value, maximum) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4) throw new RangeError('Invalid encoded input');
  const input = Buffer.from(value, 'base64');
  if (input.length > maximum || input.toString('base64') !== value) throw new RangeError('Noncanonical or excessive input');
  return new Uint8Array(input);
}

async function seedResult(target, maximum) {
  const seeds = await target.createSeeds();
  if (!Array.isArray(seeds) || !seeds.length || seeds.length > MAX_SEEDS) throw new Error('Invalid fixture seed count');
  const names = new Set();
  let total = 0;
  return { status: 'accepted', seeds: seeds.map(seed => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(seed.name) || names.has(seed.name)) throw new Error('Invalid seed name');
    names.add(seed.name);
    if (!(seed.input instanceof Uint8Array)) throw new TypeError('Seed input must be bytes');
    total += seed.input.length;
    if (total > maximum) throw new RangeError('Combined seed bytes exceed input limit');
    return { name: seed.name, inputBase64: Buffer.from(seed.input).toString('base64') };
  }) };
}

function normalizedOutcome(result) {
  if (!result || !['accepted', 'rejected', 'unsupported'].includes(result.status)) throw new Error('Invalid target result');
  const output = { status: result.status };
  if (result.code !== undefined) output.code = String(result.code).slice(0, 128);
  if (result.detail !== undefined) output.detail = String(result.detail).slice(0, 2048);
  return output;
}

function memoryMetrics(before, elapsedMs) {
  const after = process.memoryUsage();
  const heapGrowthBytes = Math.max(0, after.heapUsed - before.heapUsed);
  const externalGrowthBytes = Math.max(0, after.external - before.external);
  return {
    elapsedMs, baselineHeapBytes: before.heapUsed, heapUsedBytes: after.heapUsed, heapGrowthBytes,
    externalGrowthBytes, arrayBufferGrowthBytes: Math.max(0, after.arrayBuffers - before.arrayBuffers),
    observedGrowthBytes: heapGrowthBytes + externalGrowthBytes,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
  };
}

async function execute(request, target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Case deadline', 'AbortError')), request.budgets.caseTimeoutMs);
  const before = process.memoryUsage();
  const started = performance.now();
  try {
    const context = Object.freeze({
      maxInputBytes: request.budgets.maxInputBytes, maxOutputBytes: request.budgets.maxOutputBytes, signal: controller.signal,
    });
    const raw = request.mode === 'seeds' ? await seedResult(target, request.budgets.maxInputBytes)
      : await target.run(decodeInput(request.inputBase64, context.maxInputBytes), context);
    const metrics = memoryMetrics(before, performance.now() - started);
    const result = request.mode === 'seeds' ? raw : normalizedOutcome(raw);
    if (metrics.observedGrowthBytes > request.budgets.heapGrowthBytes) {
      return { status: 'finding', finding: { kind: 'memory-growth', detail: 'Measured heap/external growth exceeds limit' }, metrics };
    }
    return { ...result, metrics };
  } catch (error) {
    return {
      status: 'finding', finding: {
        kind: error?.name === 'AbortError' ? 'case-timeout' : 'unexpected-error',
        detail: `${error?.name ?? 'Error'}: ${error?.message ?? 'Unknown target failure'}`.slice(0, 2048),
      }, metrics: memoryMetrics(before, performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Entrypoints supply a statically imported registry; requests cannot select modules or commands. */
export async function runWorker(registry, { selfTest = false } = {}) {
  const request = await readRequest();
  if ((request.selfTest ?? false) !== selfTest || selfTest && request.mode !== 'run') throw new Error('Invalid worker mode');
  const target = Object.hasOwn(registry, request.targetId) ? registry[request.targetId] : null;
  send({ protocol: PROTOCOL, type: 'ready' });
  const result = target ? await execute(request, target) : { status: 'unsupported', code: 'TARGET_UNAVAILABLE' };
  send({ protocol: PROTOCOL, type: 'result', result });
}

export function reportWorkerFailure(error) {
  process.stderr.write(`${error.name}: ${String(error.message).slice(0, 2048)}\n`);
  process.exitCode = 1;
}
