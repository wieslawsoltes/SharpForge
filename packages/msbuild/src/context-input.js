/** Canonical compiler options shared by native and portable contexts; no paths are read by this adapter. */
export function projectContextCompilationOptions(context) {
  const language = String(context.langVersion || 'default').toLowerCase().replace(/^(\d+)\.0$/, '$1');
  const defines = [...new Set(context.defines ?? [])].sort();
  return {
    outputKind: context.outputKind || 'library',
    langVersion: language,
    defines,
    preprocessorSymbols: [...defines],
    nullable: context.nullable || 'disable',
    nullableContext: context.nullable || 'disable',
    allowUnsafe: context.unsafe === true,
    checkOverflow: context.checked === true,
    noWarn: [...new Set(context.noWarn ?? [])].sort(),
    warningsAsErrors: [...new Set(context.warningsAsErrors ?? [])].sort(),
    warningsNotAsErrors: [...new Set(context.warningsNotAsErrors ?? [])].sort(),
    treatWarningsAsErrors: context.allWarningsAsErrors === true,
    warningLevel: context.warningLevel ?? 4
  };
}

/** Hydrate context source identities from explicit records; missing contents throw SFMSB_CONTEXT_SOURCE_MISSING. */
export function projectContextCompilationInput(context, sourceRecords = new Map()) {
  const records = sourceRecords instanceof Map ? sourceRecords : new Map(sourceRecords.map(record => [record.path ?? record.uri, record]));
  const files = [];
  const seen = new Set();
  for (const source of [...context.sources, ...context.generatedSources]) {
    if (seen.has(source.path)) continue;
    if (seen.size >= 10000) throw new Error('Project context source limit exceeded');
    seen.add(source.path);
    const record = records.get(source.path);
    const text = source.text ?? (typeof record === 'string' ? record : record?.text);
    if (typeof text !== 'string') {
      throw Object.assign(new Error('Project context source is not hydrated: ' + source.path),
        { code: 'SFMSB_CONTEXT_SOURCE_MISSING', path: source.path });
    }
    files.push({ uri: source.path, text, version: record?.version ?? 1,
      readOnly: source.readOnly === true, generated: source.generated === true || source.kind != null });
  }
  return { files, options: projectContextCompilationOptions(context), references: context.references,
    analyzers: context.analyzers, additionalFiles: context.additionalFiles, analyzerConfigFiles: context.analyzerConfigFiles,
    diagnostics: context.diagnostics };
}
