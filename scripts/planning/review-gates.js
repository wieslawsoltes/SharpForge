import { readFileSync } from 'node:fs';
import { checkContractChange, contractsAt, versionsAt } from './check-contract-change.js';
import { checkSeamLock } from './golden-output.js';
import { git, isMain, report } from './lib/io.js';

const commitSha = /^[a-f0-9]{40}$/;

/** Bind GitHub's PR event labels to this run's exact head or two-parent merge checkout. */
export function reviewContext({ root = process.cwd(), event, eventName, expectedSha }) {
  if (eventName !== 'pull_request' || !event?.pull_request) {
    throw new Error('Review gates require a pull_request event snapshot');
  }
  const request = event.pull_request;
  const eventBase = request.base?.sha;
  const head = request.head?.sha;
  if (![eventBase, head, expectedSha].every(value => typeof value === 'string' && commitSha.test(value))) {
    throw new Error('Review gates require immutable base, head and workflow commit SHAs');
  }
  if (!Array.isArray(request.labels) || request.labels.some(label => typeof label?.name !== 'string' || !label.name)) {
    throw new Error('Review gates require the PR event label snapshot');
  }
  const checkout = git(['rev-parse', 'HEAD'], root).trim();
  if (checkout !== expectedSha) throw new Error('Checkout does not match the workflow commit SHA');
  const parents = git(['show', '-s', '--format=%P', checkout], root).trim().split(' ');
  if (checkout !== head && (parents.length !== 2 || parents[1] !== head)) {
    throw new Error('PR event base/head do not match this checkout');
  }
  const base = checkout === head ? eventBase : parents[0];
  // GitHub can refresh the synthetic merge after the event's base snapshot.
  // Accept only forward ancestry; the head and workflow checkout stay exact.
  if (base !== eventBase && git(['merge-base', '--all', eventBase, base], root).trim() !== eventBase) {
    throw new Error(`PR merge checkout base ${base} does not descend from event base ${eventBase}`);
  }
  // The PR diff starts at the pinned merge base, so unrelated base-branch
  // additions are not mistaken for deletions by a branch that predates them.
  const mergeBases = git(['merge-base', '--all', base, head], root).trim().split('\n');
  if (mergeBases.length !== 1 || !commitSha.test(mergeBases[0])) {
    throw new Error('Review gates require one unambiguous PR merge base');
  }
  return { base, eventBase, head, checkout, mergeBase: mergeBases[0], labels: request.labels.map(label => label.name) };
}

/** Review committed contract/golden lock changes only; never build or regenerate outputs. */
export function reviewGates(options) {
  const { root = process.cwd() } = options;
  const context = reviewContext(options);
  const { head, mergeBase, labels } = context;
  const contracts = checkContractChange({
    before: contractsAt(mergeBase, root), after: contractsAt(head, root),
    beforeVersions: versionsAt(mergeBase, root), afterVersions: versionsAt(head, root), labels,
  });
  const seam = checkSeamLock({ root, base: mergeBase, head, labels });
  const errors = [...contracts.errors, ...seam.errors];
  return { schemaVersion: 1, passed: errors.length === 0, ...context, changes: contracts.changes, errors };
}

if (isMain(import.meta.url)) {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    report(reviewGates({ event, eventName: process.env.GITHUB_EVENT_NAME, expectedSha: process.env.GITHUB_SHA }));
  } catch (error) {
    report({ schemaVersion: 1, passed: false, errors: [error.message] });
  }
}
