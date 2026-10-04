/** WinUI reference coverage excludes unrelated BCL/helper types and keeps behavior evidence separate. */
import { writeParityInventory } from '../packages/winui-controls/parity/generate-matrix.js';

const matrix = await writeParityInventory({ writeDoc: 'docs/winui-api.md', check: true });
console.log(`Generated WinUI reference coverage: ${matrix.totals.api.present}/${matrix.totals.denominator} exact signatures; `
  + `${matrix.totals.behaviorVerified} behavior-qualified rows.`);
