import { fail } from './contracts.js';
import { writeConstant } from './constant-writer.js';

function legacyScopes(method, length) {
  const spans = method.spans ?? [];
  const ranges = [
    {
      start: 0,
      end: length,
      locals: (method.locals ?? []).filter((local) => local.hidden),
      constants: method.constants ?? [],
      importScope: method.importScope ?? 0,
    },
  ];
  for (const local of (method.locals ?? []).filter((local) => !local.hidden)) {
    const start = spans[local.scopeStartPc ?? 0]?.[0] ?? 0;
    const end = local.scopeEndPc === spans.length ? length : (spans[local.scopeEndPc]?.[0] ?? length);
    if (end > start) ranges.push({ start, end, locals: [local], importScope: method.importScope ?? 0 });
  }
  return ranges;
}

function namedRows(builder, scope, counts) {
  const slots = new Set();
  const names = new Set();
  for (const local of scope.locals ?? []) {
    if (!Number.isInteger(local.slot) || local.slot < 0 || local.slot > 65535 || slots.has(local.slot)) {
      fail('Invalid or duplicate local slot');
    }
    if (typeof local.name !== 'string' || local.name.includes('\0') || names.has(local.name))
      fail('Invalid or duplicate local name');
    slots.add(local.slot);
    names.add(local.name);
    builder.add(51, [local.hidden ? 1 : 0, local.slot, builder.string(local.name)]);
  }
  const constantNames = new Set();
  for (const constant of scope.constants ?? []) {
    if (typeof constant.name !== 'string' || constant.name.includes('\0') || constantNames.has(constant.name)) {
      fail('Invalid or duplicate local constant name');
    }
    constantNames.add(constant.name);
    builder.add(52, [builder.string(constant.name), builder.blob(writeConstant(constant, counts))]);
  }
}

/** Emit sorted lexical scopes with contiguous local/constant lists, preserving legacy PC scopes. */
export function writeMethodScopes(builder, method, body, counts) {
  if (!method || !body?.code.length) return;
  const length = body.code.length;
  const ranges = [...(method.scopes ?? legacyScopes(method, length))].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  );
  if (!ranges.length || ranges[0].start !== 0 || ranges[0].end !== length)
    fail('Root local scope must span the method');
  const active = [];
  for (const scope of ranges) {
    const importScope = scope.importScope ?? method.importScope ?? 0;
    if (
      !Number.isInteger(scope.start) ||
      !Number.isInteger(scope.end) ||
      scope.start < 0 ||
      scope.end <= scope.start ||
      scope.end > length
    ) {
      fail('Local scope is outside method body');
    }
    if (!Number.isInteger(importScope) || importScope < 0 || importScope > (builder.rows[53]?.length ?? 0)) {
      fail('Invalid local scope import reference');
    }
    while (active.length && scope.start >= active.at(-1).end) active.pop();
    if (active.length && scope.end > active.at(-1).end) fail('Partially overlapping local scopes');
    active.push(scope);
    const variableStart = (builder.rows[51]?.length ?? 0) + 1;
    const constantStart = (builder.rows[52]?.length ?? 0) + 1;
    namedRows(builder, scope, counts);
    builder.add(50, [
      method.token & 0xffffff,
      importScope,
      variableStart,
      constantStart,
      scope.start,
      scope.end - scope.start,
    ]);
  }
}
