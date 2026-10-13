import {loadAssembly, equalBytes} from '@sharpforge/cil';
import {createRuntimeLaunchCandidate} from './runtime-launch.js';

/** Cache only immutable assembly decoding; every launch owns a fresh debugger, output stream and UI bridge. */
export class RuntimeSessionFactory {
  constructor() { this.loadedModule = null; }

  executable(params) {
    if (!params.assembly) return {image: params.image, load: null};
    const started = performance.now();
    const hit = this.loadedModule && equalBytes(this.loadedModule.bytes, params.assembly);
    if (!hit) this.loadedModule = {bytes: params.assembly.slice(), image: loadAssembly(params.assembly)};
    return {image: this.loadedModule.image, load: {format: 'ECMA-335', cacheHit: !!hit,
      milliseconds: performance.now() - started, bytes: params.assembly.length}};
  }

  create(params, runtimeOptions = {}) {
    return createRuntimeLaunchCandidate(params, {
      ...runtimeOptions, executable: values => this.executable(values)
    }).candidate;
  }
}
