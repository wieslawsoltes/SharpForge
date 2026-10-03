/**
 * Declaration rules of init accessors (C# 9, SF-A02-T10.4). Where an init-only member may be assigned is decided
 * at each assignment (binder/ref-kinds.js, CS8852); here: an init accessor is not valid on a static member (CS8856).
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { SymbolKind } from '../../symbols/types.js';

/** Rows `{member, code, args, at}` for the init accessors a type declares; `at` is the `init` keyword. */
export function checkInitAccessors(type) {
  const rows = [];
  for (const member of type.getMembers()) {
    if (member.kind !== SymbolKind.Property || !member.setMethod?.isInitOnly || !member.isStatic) continue;
    rows.push({ member, code: DiagnosticId.CS8856, args: [], at: member.setMethod.syntax?.keyword ?? null });
  }
  return rows;
}
