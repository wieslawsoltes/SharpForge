import {microbenchmarks, startupApps} from './fixtures.js';

/** Reuse the exact established sources/results without adding or changing any T12 row. */
export const arrayLatencyFixtures = Object.freeze([
  Object.freeze({fixture: startupApps.find(fixture => fixture.id === 'grid'), kind: 'rectangular',
    work: 'Allocate int[8,8], write and read every element through two indices, and output the complete sum.'}),
  Object.freeze({fixture: microbenchmarks.find(fixture => fixture.id === 'arrays'), kind: 'vector',
    work: 'Allocate and initialize int[256], scan all elements 80 times, and output the complete sum.'})
]);
