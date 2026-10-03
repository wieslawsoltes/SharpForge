/** Address evaluation reads receivers/indices; an out local becomes assigned only after the call. */
export function referenceArgumentFlow(builder, node) {
  if (node.kind !== 'Call') return false;
  if (node.intrinsic?.reference) {
    const target = node.args[0], variable = builder.target(target);
    if (variable && !node.intrinsic.reference.out) builder.op('read', variable, target);
    return true;
  }
  if (!node.args.some(argument => argument.intrinsic?.reference?.out)) return false;
  if (node.receiver) builder.expr(node.receiver);
  const writes = [];
  for (const argument of node.args) {
    if (argument.intrinsic?.reference?.out) {
      const target = argument.args[0], variable = builder.target(target);
      if (variable) writes.push({variable, target});
    } else builder.expr(argument);
  }
  for (const {variable, target} of writes) builder.op('write', variable, target);
  return true;
}
