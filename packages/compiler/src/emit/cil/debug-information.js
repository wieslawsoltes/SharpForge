import { emitPortablePdb, attachPortablePdb, PdbGuids } from '@sharpforge/symbols';
import { CilDebugSources } from './debug-source.js';
import { CilMethodDebugInformation } from './debug-method.js';

/** Create the optional direct-CIL symbol producer; false avoids source maps, stream markers, and PDB work. */
export function createCilDebugInformation(analysis, options = {}) {
  const enabled = options.portablePdb === true || (options.portablePdb !== false && options.embeddedPdb === true);
  return enabled ? new CilDebugInformation(analysis, options) : null;
}

class CilDebugInformation {
  constructor(analysis, options) {
    this.options = options;
    this.sources = new CilDebugSources(analysis.files);
    this.bodies = [];
    this.entryPointKey = null;
  }
  method(emitter) {
    return new CilMethodDebugInformation(emitter, this.sources);
  }
  record(method, il, body) {
    if (il.debug) this.bodies.push({ method, debug: il.debug, body });
  }
  /** The selected source kickoff, including the bound top-level body; supplied by entry point selection. */
  entryPoint(key) {
    this.entryPointKey = key;
  }
  /** Resolve tokens only after all emitted methods and late state-machine fields have their final definitions. */
  symbolData() {
    const methods = [];
    const sequencePoints = [];
    const custom = [];
    const machines = new Map();
    for (const { method, debug, body } of this.bodies) {
      const token = method.token;
      const layout = body.debugOffsets;
      const { scopes, hoistedScopes } = debug.scopes.resolve(layout, body.code.length);
      methods.push({ token, scopes });
      for (const point of debug.sequencePoints(layout, body.code.length)) sequencePoints.push({ ...point, methodToken: token });
      const machine = debug.kickoffMachine ?? debug.frame.stateMachine;
      if (!machine) continue;
      let record = machines.get(machine);
      if (!record) machines.set(machine, (record = {}));
      if (debug.kickoffMachine) record.kickoff = token;
      else if (machine.moveNext === method) {
        record.moveNext = token;
        if (hoistedScopes.length) custom.push({ parent: token, kind: PdbGuids.hoistedScopes, scopes: hoistedScopes });
        if (machine.kind !== 'iterator') Object.assign(record, debug.asyncSteps(layout, token, machine.kickoff.key === this.entryPointKey));
      }
    }
    return { sources: [...this.sources.documents.values()], methods, sequencePoints, stateMachines: [...machines.values()], custom };
  }
  finish(emitted) {
    const options = this.options;
    const symbols = emitPortablePdb(emitted.bytes, this.symbolData(), { embedSources: options.embedSources ?? true, sourceLink: options.sourceLink });
    const bytes = attachPortablePdb(emitted.bytes, symbols.bytes, {
      path: (options.name ?? 'Application') + '.pdb',
      embedded: options.embeddedPdb ?? false,
    });
    return { ...emitted, bytes, pdb: symbols.bytes };
  }
}
