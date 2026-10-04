import { compilerSourceLimits } from '../workers/compiler-limits.js';
import { documentSize } from './document-size.js';

const available = Object.freeze({ available: true });

/** Check published source metadata before reading any lazy text. Editor/import bounds are separate. */
export function compilerSourceAvailability(documents, records, projectId) {
  if (records.length > compilerSourceLimits.maxDocuments) return unavailable('STUDIO_COMPILER_DOCUMENT_LIMIT', projectId,
    `Project '${projectId}' has ${records.length} sources; the compiler supports at most ${compilerSourceLimits.maxDocuments}.`);
  for (const record of records) {
    const length = documentSize(documents, record);
    if (length === null) return unavailable('STUDIO_COMPILER_SOURCE_METADATA', projectId,
      `Source size metadata is unavailable for '${record.uri}'.`, record.uri);
    if (length > compilerSourceLimits.maxDocumentLength) return unavailable('STUDIO_COMPILER_SOURCE_LIMIT', projectId,
      `Source '${record.uri}' has ${length} UTF-16 units; the compiler supports at most ${compilerSourceLimits.maxDocumentLength} per source.`,
      record.uri);
  }
  return available;
}

function unavailable(code, projectId, reason, uri) {
  return { available: false, code, projectId, uri,
    reason: `${reason} Editing, saving and text search remain available; project language services and compilation are unavailable.` };
}

export function compilerSourceError(availability) {
  return Object.assign(new RangeError(availability.reason), {
    code: availability.code, projectId: availability.projectId, uri: availability.uri
  });
}
