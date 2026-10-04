import { NativeBinlogReader } from './binlog/reader.js';

/** Register the SDK-backed bounded binary-log reader. */
export function registerNativeBinlogServices(registry, { engine }) {
  const binlog = new NativeBinlogReader(engine);
  registry.register('binlog', 'query', (request, options) => binlog.query(request.jobId, { ...request, ...options }));
  return { binlog };
}
