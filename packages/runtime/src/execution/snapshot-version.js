export const snapshotSchemaVersion = 2;

/** Reject incompatible execution layouts before replacing any live execution state. */
export class SnapshotVersionError extends TypeError {
  constructor(engine) {
    super(`Unsupported ${engine} VM snapshot schema version`);
    this.name = 'SnapshotVersionError';
    this.code = 'SNAPSHOT_SCHEMA_VERSION';
  }
}
