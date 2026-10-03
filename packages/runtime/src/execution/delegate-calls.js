// Compatibility seam for existing callers; execution/delegates owns the delegate model.
export {
  delegateEntries, delegatesEqual, constructDelegate, combineDelegates, removeDelegate,
  invokeDelegate, continueDelegate, invokeDelegateOperation
} from './delegates.js';
