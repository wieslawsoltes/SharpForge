/**
 * Ref struct locals in async methods and iterators (SF-A02-T82, C# 13 "ref and unsafe in async and iterator methods").
 *
 * A ref struct local may be declared there, but its value cannot be kept across an `await` or a `yield return`:
 * reading it after the suspension is CS4007, reported where Roslyn reports it - on the local, or on the field access
 * when one field is read. A value written after the suspension is a new value: `r = new R()` covers every later
 * read, `r.F = x` covers later reads of `r.F`.
 *
 * Roslyn decides this from the liveness of the local in the lowered state machine. Here it is decided from the
 * order of the source text, like CS9217 for ref locals (./csharp13.js): a read is after a suspension when a
 * suspension inside the local's scope lies between the last covering write and the read, or when both are in a loop
 * the local was declared outside of and no covering write precedes the read in that loop. A write covers a read
 * only when the statement list it belongs to encloses the read (a write under an `if` does not cover what follows
 * the `if`). Not modelled: `goto`, reads in `catch` / `finally` after a suspension in the `try`, partial writes of a
 * struct with several fields that together assign all of it, and suspensions other than `await` and `yield return`
 * (`await foreach`, `await using`). Lambdas and local functions inside the body are not looked into.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { RefKind } from '../symbols/types.js';
import { forEachChild } from '../bound/semantic-walker.js';
import { isRefLike } from './ref-struct.js';

const loopKinds = new Set(['WhileStatement', 'DoStatement', 'ForStatement', 'ForEachStatement', 'ForEachVariableStatement']);
const listKinds = new Set(['Block', 'SwitchSection']);
const spanOf = node => node.span ?? node;
const contains = (outer, inner) => outer.start <= inner.start && inner.end <= outer.end;
const isRefStructLocal = node => node?.kind === 'Local' && (!node.local?.refKind || node.local.refKind === RefKind.None) && isRefLike(node.local?.type);

/** The span of the statement list a syntax node belongs to: its block, or the embedded statement it is. */
function listOf(syntax) {
  for (let node = syntax; node?.parent; node = node.parent) {
    if (listKinds.has(node.parent.kind)) return spanOf(node.parent);
    if (node.kind.endsWith('Statement') && !listKinds.has(node.parent.kind)) return spanOf(node);
  }
  return null;
}
/** The span of the block a local declared at `syntax` is in scope of. */
function scopeOf(syntax) {
  for (let node = syntax?.parent; node; node = node.parent) if (listKinds.has(node.kind)) return spanOf(node);
  return null;
}

/** The suspensions of a body and the reads and writes of its ref struct locals, in tree order. */
function collect(body) {
  const suspensions = [],
    reads = [],
    writes = [];
  const visit = node => {
    if (node.kind === 'Lambda' || node.kind === 'LocalFunction') return;
    if (node.kind === 'Await' || node.kind === 'YieldReturn') suspensions.push(spanOf(node.syntax));
    if (node.kind === 'Assignment') {
      const left = node.left,
        field = left?.kind === 'FieldAccess' && isRefStructLocal(left.receiver) ? left.field?.name : null,
        local = field ? left.receiver.local : isRefStructLocal(left) ? left.local : null;
      if (local) {
        // The value is stored once the right side has been evaluated: the write is at the end of the assignment.
        visit(node.right);
        writes.push({ local, field, span: spanOf(node.syntax), list: listOf(node.syntax) });
        return;
      }
    }
    if (node.kind === 'FieldAccess' && isRefStructLocal(node.receiver)) {
      reads.push({ local: node.receiver.local, field: node.field?.name ?? null, syntax: node.syntax });
      return;
    }
    if (isRefStructLocal(node)) reads.push({ local: node.local, field: null, syntax: node.syntax });
    forEachChild(node, visit);
  };
  visit(body);
  return { suspensions, reads, writes };
}

/**
 * The reads of ref struct locals that come after a suspension.
 * @param body a bound method body  @returns {{node: object, code: string, args: any[]}[]}
 */
export function refStructLocalsAcrossSuspensions(body) {
  const { suspensions, reads, writes } = collect(body);
  if (!suspensions.length || !reads.length) return [];
  const rows = [];
  for (const read of reads) {
    const declaration = read.local.syntax ?? read.local.locations?.[0],
      scope = scopeOf(read.local.syntax),
      at = spanOf(read.syntax);
    if (!scope || !declaration) continue;
    const declared = spanOf(declaration).start,
      covering = writes.filter(
        write =>
          write.local === read.local &&
          (write.field === null || write.field === read.field) &&
          write.span.end <= at.start &&
          !!write.list &&
          contains(write.list, at),
      ),
      bound = Math.max(declared, ...covering.map(write => write.span.end));
    let crossed = suspensions.some(suspension => contains(scope, suspension) && suspension.start >= bound && suspension.end <= at.start);
    for (let node = read.syntax.parent; node && !crossed; node = node.parent) {
      const loop = loopKinds.has(node.kind) ? spanOf(node) : null;
      if (!loop || !contains(scope, loop) || (loop.start <= declared && declared < loop.end)) continue;
      // The back edge of the loop carries a suspension to the read unless the value is written first in the iteration.
      if (!covering.some(write => write.span.start >= loop.start)) crossed = suspensions.some(suspension => contains(loop, suspension));
    }
    if (crossed) rows.push({ node: read.syntax, code: DiagnosticId.CS4007, args: [read.local.type.toDisplayString()] });
  }
  return rows;
}
