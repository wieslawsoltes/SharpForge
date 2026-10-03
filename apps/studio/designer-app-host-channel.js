import {DesignerWorkerChannel} from './designer-worker-channel.js';
import {DesignerAppHostError} from './designer-app-host-errors.js';

const appCodes = Object.freeze({
  SFDW0002: 'SFDA0002', SFDW0003: 'SFDA0003', SFDW0004: 'SFDA0004', SFDW0005: 'SFDA0005', SFDW0006: 'SFDA0006'
});

/** Independent app workers share the transport while retaining the app-host diagnostic contract. */
export class DesignerAppWorkerChannel extends DesignerWorkerChannel {
  constructor(worker, options = {}) {
    super(worker, {...options, kind: 'runtime', label: 'App',
      createError: (message, code) => new DesignerAppHostError(message, appCodes[code] ?? code)});
  }
}
