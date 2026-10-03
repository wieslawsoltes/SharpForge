export const snapshotSchemaVersion = 4;

/** A version mismatch is rejected before execution state can be replaced. */
export class SnapshotVersionError extends TypeError {
  constructor(engine) {
    super(`Unsupported ${engine} VM snapshot schema version`);
    this.name = 'SnapshotVersionError';
    this.code = 'SNAPSHOT_SCHEMA_VERSION';
  }
}
