/** Filter writes reach only the selected handler; a false filter resumes exception search. */
export function appendCatchFlow(builder, clause, entry, ends) {
  const handler = builder.block();
  handler.exceptionSources.push(entry);
  builder.current = handler;
  if (clause.local) {
    builder.graph.locals.add(clause.local);
    builder.op('write', clause.local, clause, {value: null, catchVariable: true});
  }
  if (clause.filter) {
    const accepted = builder.block();
    const rejected = builder.block();
    builder.condition(clause.filter, accepted, rejected);
    builder.current = rejected;
    builder.terminate({kind: 'throw', node: null});
    builder.current = accepted;
  }
  builder.stmt(clause.body);
  ends.push(builder.current);
}
