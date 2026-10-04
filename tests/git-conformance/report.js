import assert from 'node:assert/strict';

/** Every differential assertion contributes to one named command family's CI result. */
export class ConformanceReport {
  constructor(reference) {
    this.reference = reference;
    this.families = {};
    this.failures = [];
  }

  equal(family, label, actual, expected) {
    const counts = this.families[family] ??= { passed: 0, failed: 0 };
    try { assert.deepEqual(actual, expected, label); counts.passed++; }
    catch (error) {
      counts.failed++;
      this.failures.push({ family, label, message: error.message.slice(0, 2000) });
      error.conformanceRecorded = true;
      throw error;
    }
  }

  failure(family, error) {
    if (error.conformanceRecorded) return;
    (this.families[family] ??= { passed: 0, failed: 0 }).failed++;
    this.failures.push({ family, message: error.message.slice(0, 2000) });
  }

  summary() {
    const counts = Object.values(this.families);
    return {
      schema: 'sharpforge.git.conformance.v1', reference: this.reference, platform: process.platform, node: process.version,
      families: this.families, passed: counts.reduce((sum, count) => sum + count.passed, 0),
      failed: counts.reduce((sum, count) => sum + count.failed, 0), failures: this.failures
    };
  }
}
