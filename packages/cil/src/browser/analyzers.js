import { AssemblyInspector } from '../inspector.js';
import { CilOpcodes, decodeInstructions } from '../opcodes.js';
import { metadataTokenUri } from './navigation.js';
import { invalidUsage, usageLimit, usageLimits, usageCancelled, usageToken, usageHeaders } from './analyzers-input.js';
import { usageTargets } from './analyzers-targets.js';
import { declarationRelations, snapshotDeclarationRelations } from './analyzers-declarations.js';

const queryTables = { uses: [6], 'used-by': [1, 2, 4, 6, 10, 17, 27, 43],
  'instantiated-by': [1, 2, 27], 'assigned-by': [4, 10], 'overridden-by': [6], 'implemented-by': [6] };

/** Owned instruction-use occurrences for one module. No PE, inspector, decoded body or binding cache is retained. */
export class AssemblyUsageAnalysis {
  #edges = [];
  #indices = new Map(Object.keys(queryTables).filter(key => !declarationRelations.includes(key)).map(key => [key, new Map()]));
  #counts;
  #prefix;
  #storage;
  #diagnostics;
  #bodyComplete;
  #declarationComplete = new Map();

  constructor(inspector, options = {}) {
    if (!(inspector instanceof AssemblyInspector)) invalidUsage('loaded AssemblyInspector required');
    const limits = usageLimits(options);
    if (options.metadataLimits !== undefined && (!options.metadataLimits || typeof options.metadataLimits !== 'object'
      || Array.isArray(options.metadataLimits))) invalidUsage('metadata limits');
    const preflight = usageHeaders(inspector, limits, options.signal);
    this.#counts = Array.from({ length: 53 }, (_, table) => inspector.metadata.rows[table]?.length ?? 0);
    this.#prefix = metadataTokenUri(inspector.metadata, 1).slice(0, -10);
    this.#diagnostics = preflight.diagnostics;
    this.#bodyComplete = preflight.diagnostics.length === 0;
    this.#storage = { methods: preflight.methods, codeBytes: preflight.codeBytes, instructions: 0, usages: 0, indexEntries: 0 };
    const target = usageTargets(inspector, this.#counts, options);
    for (const header of preflight.headers) {
      usageCancelled(options.signal);
      const code = inspector.pe.bytes.subarray(header.offset, header.offset + header.size);
      const instructions = decodeInstructions(code, { maxInstructions: limits.maxInstructions - this.#storage.instructions });
      this.#storage.instructions += instructions.length;
      for (const instruction of instructions) {
        usageCancelled(options.signal);
        if (instruction.operandKind !== 'token' || CilOpcodes[instruction.name].tokenKind === 'string') continue;
        if (this.#edges.length >= limits.maxUsages) usageLimit('occurrences');
        const facts = target(instruction);
        const edge = { sourceToken: header.token, operandToken: instruction.operand, targetToken: facts.targetToken,
          offset: instruction.offset, opcode: instruction.name, status: facts.status, reason: facts.reason,
          instantiatedTypeToken: facts.instantiatedType };
        const position = this.#edges.length;
        this.#edges.push(edge);
        this.#add('uses', header.token, position);
        this.#targets('used-by', edge.targetToken, edge.operandToken, position);
        if (facts.instantiatedType) this.#targets('instantiated-by', facts.instantiatedType, facts.declaredType, position);
        if (instruction.name === 'stfld' || instruction.name === 'stsfld')
          this.#targets('assigned-by', edge.targetToken, edge.operandToken, position);
      }
    }
    this.#storage.usages = this.#edges.length;
    if (options.methodRelations !== undefined) {
      const snapshot = snapshotDeclarationRelations(options.methodRelations, {
        counts: this.#counts, prefix: this.#prefix, limits, signal: options.signal,
      });
      this.#declarations(snapshot);
    }
  }

  #declarations(snapshot) {
    for (const relation of declarationRelations) {
      this.#indices.set(relation, new Map());
      this.#declarationComplete.set(relation, !snapshot.diagnostics.some(diagnostic => diagnostic.relation === relation));
    }
    for (const entry of snapshot.entries) {
      const position = this.#edges.length;
      this.#edges.push(entry);
      this.#add(entry.relation, entry.targetToken, position);
    }
    this.#diagnostics.push(...snapshot.diagnostics);
    this.#storage.declarationRelations = snapshot.entries.length;
    this.#storage.declarationDiagnostics = snapshot.diagnostics.length;
  }

  #add(relation, token, position) {
    const index = this.#indices.get(relation);
    let entries = index.get(token);
    if (!entries) index.set(token, entries = []);
    entries.push(position);
    this.#storage.indexEntries++;
  }
  #targets(relation, target, operand, position) {
    this.#add(relation, target, position);
    if (operand !== target) this.#add(relation, operand, position);
  }
  #uri(token) { return this.#prefix + '0x' + token.toString(16).padStart(8, '0'); }
  get storage() { return { ...this.#storage }; }
  get diagnostics() { return this.#diagnostics.map(value => ({ ...value })); }

  /** Bounded owned occurrence page in physical MethodDef/IL order; empty pages have no continuation. */
  query(relation, token, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) invalidUsage('query options');
    const { offset = 0, limit = 100, signal } = options;
    const index = this.#indices.get(relation);
    if (!index) invalidUsage('unsupported relation');
    usageToken(this.#counts, token, queryTables[relation]);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 0 || limit > 1000)
      invalidUsage('page');
    usageCancelled(signal);
    const positions = index.get(token) ?? [], end = Math.min(positions.length, offset + limit), entries = [];
    for (let position = offset; position < end; position++) {
      usageCancelled(signal);
      const edge = this.#edges[positions[position]];
      entries.push({ ...edge, source: this.#uri(edge.sourceToken), target: this.#uri(edge.targetToken) });
    }
    return { entries, total: positions.length, nextOffset: limit && end < positions.length ? end : null,
      complete: this.#declarationComplete.get(relation) ?? this.#bodyComplete };
  }
}
