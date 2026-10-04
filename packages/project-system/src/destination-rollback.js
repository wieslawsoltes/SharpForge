/** Undo only entries created or overwritten by this operation, in reverse dependency order. */
export async function rollbackDestination(journal) {
  const leftovers = [];
  for (const entry of [...journal].reverse()) {
    try {
      if (entry.kind === 'overwrite') {
        const stream = await entry.handle.createWritable();
        try { await stream.write(entry.bytes); await stream.close(); }
        catch (error) { await stream.abort().catch(abortError => { error.abortError = abortError; }); throw error; }
      } else {
        await entry.parent.removeEntry(entry.name, { recursive: false });
      }
    } catch (error) {
      if (error.name === 'NotFoundError' && entry.kind !== 'overwrite') continue;
      leftovers.push({ path: entry.path, operation: entry.kind === 'overwrite' ? 'restore' : 'remove', message: error.message });
    }
  }
  return { rolledBack: leftovers.length === 0, leftovers };
}
