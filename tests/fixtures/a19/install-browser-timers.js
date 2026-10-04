import { browserGlobalTimers } from '../../support/browser-global-timers.js';

// Install before evaluating the production worker, including its RuntimeActivity default dependencies.
Object.assign(globalThis, browserGlobalTimers());
