import {ProviderTransactionAdapter, workspaceRecordSource} from '@sharpforge/workspace';
import {encodedWorkspaceSourceChunks} from '@sharpforge/project-system';
import {studioDiskLimits} from '../workbench/workspace-limits.js';

const sourceContent = record => workspaceRecordSource(record) ?? record?.text;

/** C# records changed by an operation must remain reopenable before any provider effect is admitted. */
export class ExplorerSourceTransactionAdapter extends ProviderTransactionAdapter {
  async preflight(operations, options) {
    const {before, after, signal} = options;
    const previous = new Map(before.records.map(record => [record.path, record]));
    for (const record of after.records) {
      if (!/\.cs$/i.test(record.path)) continue;
      const content = sourceContent(record);
      if (content === undefined) continue;
      const old = previous.get(record.path);
      if (old && sourceContent(old) === content && old.encoding === record.encoding && !!old.bom === !!record.bom) continue;
      // Encoding yields bounded chunks and rejects NUL, ambiguous leading BOM text and malformed surrogates.
      for await (const _chunk of encodedWorkspaceSourceChunks(content, {
        path: record.path, encoding: record.encoding, bom: record.bom, signal, maxBytes: studioDiskLimits.maxFileBytes
      })) {
        signal?.throwIfAborted();
      }
    }
    return super.preflight(operations, options);
  }
}
