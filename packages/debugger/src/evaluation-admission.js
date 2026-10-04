import {verifyCilAssembly} from '@sharpforge/cil';

/** Publish newly verified evaluation roots by replacement so execution membership caches observe the change. */
export function admitEvaluationMethod(vm, methodToken) {
  const report = verifyCilAssembly(vm.inspector, {methodToken});
  if (!report.success) throw new Error(report.issues.map(issue => issue.message).join('; '));
  const methods = new Set(vm.report.methods);
  for (const token of report.methods) methods.add(token);
  if (methods.size !== vm.report.methods.length) vm.report.methods = [...methods];
}
