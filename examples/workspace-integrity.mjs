import {WorkspaceTransactionJournal, FileOperationHistory, mergeWorkspaceText,
  encodeRecoveryRecord, decodeRecoveryRecord} from '../packages/workspace/src/index.js';

let state = {name: 'Integrity sample', records: [{path: 'Program.cs', text: 'class Program {}'},
  {path: 'Assets/raw.bin', bytes: Uint8Array.of(0, 128, 255)}], folders: []};
const journal = new WorkspaceTransactionJournal({getState: () => state, commitState: async value => { state = value; }});
const history = new FileOperationHistory(journal);
const receipt = await history.execute([{kind: 'move', path: 'Program.cs', destination: 'Source/Program.cs'}]);
await history.undo();
await history.redo();
const merged = mergeWorkspaceText('first\nsecond\nthird\n', 'FIRST\nsecond\nthird\n', 'first\nsecond\nTHIRD\n');
const recovered = await decodeRecoveryRecord(await encodeRecoveryRecord(state));
console.log(JSON.stringify({status: receipt.status, files: state.records.map(record => record.path),
  merged: merged.text, recoveredBinary: [...recovered.records.find(record => record.path === 'Assets/raw.bin').bytes]}, null, 2));
