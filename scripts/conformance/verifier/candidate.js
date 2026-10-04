import { AssemblyInspector, verifyCilAssembly } from '@sharpforge/cil';

const unsupported = new Set(['IL_NATIVE', 'IL_SIGNATURE', 'IL_FILTER', 'IL_OPCODE', 'IL_TYPE', 'IL_GENERIC',
  'IL_REFERENCE', 'IL_DISPATCH', 'IL_FIELD', 'IL_TOKEN', 'IL_METADATA', 'IL_LIMIT']);

/** Consume the public constrained verifier without confusing unsupported execution with invalid ECMA IL. */
export function verifyCandidate(bytes, method = 'Test::Run') {
  try {
    const inspector = new AssemblyInspector(bytes);
    const matches = [...inspector.methods.values()].filter(row => `${row.owner}::${row.name}` === method || row.name === method);
    if (matches.length !== 1) throw new Error('Expected one selected method');
    const report = verifyCilAssembly(inspector, { methodToken: matches[0].token });
    if (report.issues.some(issue => unsupported.has(issue.code))) {
      return { status: 'unsupported', profile: report.profile, issues: report.issues };
    }
    return { status: 'observed', accepted: report.success, profile: report.profile, issues: report.issues };
  } catch (error) {
    return { status: 'unsupported', reason: `Public verifier could not inspect/select the method: ${error.message}` };
  }
}
