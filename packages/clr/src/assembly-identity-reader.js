import { assemblyIdentityFromRow } from './identity.js';

function namedIdentityRow(row, reference) {
  if (!reference) return { MajorVersion: row[1], MinorVersion: row[2], BuildNumber: row[3], RevisionNumber: row[4],
    Flags: row[5], PublicKey: row[6], Name: row[7], Culture: row[8] };
  return { MajorVersion: row[0], MinorVersion: row[1], BuildNumber: row[2], RevisionNumber: row[3],
    Flags: row[4], PublicKeyOrToken: row[5], Name: row[6], Culture: row[7] };
}

/** Shared Assembly/AssemblyRef row projection; identity validation and public-key handling stay in the canonical identity service. */
export function readIdentity(metadata, row, reference, signal) {
  return assemblyIdentityFromRow(namedIdentityRow(row, reference), {
    reference, signal, readString: index => metadata.string(index), readBlob: index => metadata.blob(index),
  });
}
