import { GitError } from '@sharpforge/git';
import { checkGitWorkspaceLoad, checkGitWorkspaceLoadOwnership, gitWorkspaceAdoptionOptions } from './git-workspace-load.js';

const receipts = new WeakMap();

function restoreBinding(workbench, previous, validate) {
  // A failed precommit may race another workspace load; only the original, still-valid binding can be restored.
  try { validate(); }
  catch { return; }
  workbench.workspaceBound = previous.bound;
}

function committedFailure(error, additional = []) {
  if (!additional.length && error?.committed) return error;
  const failure = new AggregateError([error, ...additional],
    'Workspace source adoption committed, but Git loading did not finish');
  failure.committed = true;
  return failure;
}

function finishReceipt(workbench, receipt, options) {
  try {
    checkGitWorkspaceLoadOwnership(options);
    if (receipts.get(workbench) !== receipt || workbench.repositoryId !== receipt.repositoryId ||
        workbench.host.getWorkspaceIdentity() !== receipt.identity) {
      throw new GitError('Conflict', 'Another workspace or repository replaced the files adopted by this Git operation');
    }
  } catch (error) {
    if (receipts.get(workbench) === receipt && workbench.repositoryId === receipt.repositoryId) workbench.workspaceBound = false;
    throw error;
  }
}

/** The host must report onCommitted synchronously at its source transaction, before asynchronous build or finish work. */
export async function adoptGitWorkspace(workbench, records, options, adoption, publish) {
  const previous = { repositoryId: workbench.repositoryId, bound: workbench.workspaceBound };
  const validate = () => {
    checkGitWorkspaceLoad(options);
    if (workbench.repositoryId !== previous.repositoryId) {
      throw new GitError('Conflict', 'The selected Git repository changed while preparing the workspace');
    }
  };
  let receipt;
  const onCommitted = () => {
    if (receipt) throw committedFailure(new GitError('Conflict', 'Workspace loader reported its commit more than once'));
    receipt = { repositoryId: workbench.repositoryId, identity: null };
    try {
      checkGitWorkspaceLoadOwnership(options);
      if (workbench.repositoryId !== previous.repositoryId) throw new GitError('Conflict', 'The Git repository changed during adoption');
      receipt.identity = workbench.host.getWorkspaceIdentity();
      receipts.set(workbench, receipt);
      publish();
      receipt.repositoryId = workbench.repositoryId;
    } catch (error) {
      if (receipts.get(workbench) === receipt) workbench.workspaceBound = false;
      throw committedFailure(error);
    }
  };
  const hostOptions = { ...gitWorkspaceAdoptionOptions(options, adoption), validate, onCommitted };
  validate();
  workbench.workspaceBound = false;
  let result;
  let failure;
  let failed = false;
  try { result = await workbench.host.adoptRecords(records, hostOptions); }
  catch (error) { failed = true; failure = error; }
  if (!receipt) {
    if (failed) {
      if (!failure?.committed) restoreBinding(workbench, previous, validate);
      throw failure;
    }
    if (result === null || result === false) {
      restoreBinding(workbench, previous, validate);
      throw new GitError('Cancelled', 'Workspace loading was cancelled. The prepared repository remains available in Git Changes.');
    }
    throw committedFailure(new GitError('Unsupported', 'Workspace loader did not report its commit boundary; the Git binding remains inactive'));
  }
  let completionFailure;
  let completionFailed = false;
  try { finishReceipt(workbench, receipt, options); }
  catch (error) { completionFailed = true; completionFailure = error; }
  if (failed) throw committedFailure(failure, completionFailed ? [completionFailure] : []);
  if (completionFailed) throw committedFailure(completionFailure);
  if (result === null || result === false) throw committedFailure(new GitError('Conflict', 'Workspace loader declined after committing source'));
  return result;
}
