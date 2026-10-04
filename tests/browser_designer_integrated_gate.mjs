/** Run once against the completed A18 build: CHROMIUM_EXECUTABLE=... SHARPFORGE_BROWSER_URL=http://127.0.0.1:PORT node this-file. */
import {assert, createGate} from './browser_designer_gate_harness.mjs';
import {propertyAndKeyboard, singleCommandBar, nestedComponent} from './browser_designer_gate_interactions.mjs';
import {authoredPreviews} from './browser_designer_gate_previews.mjs';
import {largeScenePerformance, layoutReferences} from './browser_designer_gate_performance.mjs';
import {defaultEventAndInline, layoutGestures} from './browser_designer_gate_editing.mjs';
import {sourceAnalysisLatency} from './browser_designer_gate_source_latency.mjs';
import {keyboardOnlyPage} from './browser_designer_gate_keyboard.mjs';

const cases = [
  ['property', 'Actual property commit updates C# and repeated geometry keys form one undo transaction', gate => propertyAndKeyboard(gate.page)],
  ['keyboard-page', 'An empty Page becomes a Grid with two TextBoxes and a Button through trusted keyboard input only', keyboardOnlyPage],
  ['chrome', 'One document command bar stays accessible at narrow and wide light/dark dimensions', gate => singleCommandBar(gate.page)],
  ['events', 'Default-event double-click creates or navigates C# while F2 and slow-click retain inline editing',
    gate => defaultEventAndInline(gate.page)],
  ['layout', 'Canvas conversion, real margin drags and held ordering preserve geometry and exact undo', gate => layoutGestures(gate.page)],
  ['previews', 'Resources, authorized assets, visual states and adaptive widths render without preview mutations', gate => authoredPreviews(gate.page)],
  ['components', 'Nested component preview opens its own document by double-click and context command', gate => nestedComponent(gate.page)],
  ['references', 'Canvas/Grid/StackPanel/ScrollViewer/Viewbox DOM geometry matches both managed engines within 0.5px',
    gate => layoutReferences(gate.page)],
  ['source-latency', '3000-line production analysis preserves trusted input latency and cancels obsolete source requests', sourceAnalysisLatency],
  ['performance', 'A real 5000-node scene stays within the 16 ms selection and drag main-thread budget', largeScenePerformance]
];
const requested = [...new Set(process.env.SHARPFORGE_DESIGNER_CASES?.split(',').map(id => id.trim()).filter(Boolean) ?? cases.map(([id]) => id))];
assert(requested.length && requested.every(id => cases.some(([name]) => name === id)), 'Unknown or empty SHARPFORGE_DESIGNER_CASES.');
const measuresInput = requested.some(id => ['source-latency', 'performance'].includes(id));
const captureMode = process.env.SHARPFORGE_DESIGNER_CAPTURE ?? (measuresInput ? 'measurement' : 'diagnostic');
const gate = await createGate({captureMode});
gate.report.requestedCases = requested;
gate.report.completeMatrix = requested.length === cases.length;
let failure;
try {
  for (const [id, name, run] of cases) {
    if (requested.includes(id)) await gate.check(name, () => run(gate));
  }
  assert.deepEqual(gate.report.errors, [], 'Browser page errors occurred.');
  assert.deepEqual(await gate.page.evaluate(() => window.__a18CspViolations), [], 'The browser observed a production CSP violation.');
} catch (error) {
  failure = error;
  process.exitCode = 1;
  process.stderr.write(`${error.stack}\n`);
} finally {
  await gate.close(failure);
}
