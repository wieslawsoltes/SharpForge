import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {ManagedUIWorkQueue} from '../packages/runtime/src/ui/work-queue.js';

// Released event delegate signatures remain unchanged; casts select the declared family argument contracts.
const source = `using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Threading.Tasks;
class Program {
  static TextBlock label;
  static async void Primary(object sender, RoutedEventArgs value) {
    ContentDialogPrimaryButtonClickEventArgs args = (ContentDialogPrimaryButtonClickEventArgs)value;
    Windows.Foundation.Deferral deferral = args.GetDeferral();
    label.Text = "prefix";
    await Task.Delay(10);
    args.Cancel = true;
    label.Text = "completed";
    deferral.Complete();
  }
  static void Next(object sender, RoutedEventArgs value) { label.Text = label.Text + "|second"; }
  static void Main() {
    label = new TextBlock { Name = "label", Text = "initial" };
    TextBox edit = new TextBox { Name = "edit", Text = "original" };
    edit.BeforeTextChanging += (sender, value) => {
      TextBoxBeforeTextChangingEventArgs args = (TextBoxBeforeTextChangingEventArgs)value;
      args.Cancel = args.NewText == "blocked";
    };
    ContentDialog dialog = new ContentDialog { Name = "dialog" };
    dialog.PrimaryButtonClick += Primary;
    dialog.PrimaryButtonClick += Next;
    RefreshContainer refresh = new RefreshContainer { Name = "refresh" };
    refresh.RefreshRequested += (sender, value) => {
      RefreshContainerRefreshRequestedEventArgs args = (RefreshContainerRefreshRequestedEventArgs)value;
      args.GetDeferral();
    };
    StackPanel panel = new StackPanel();
    panel.Children.Add(label);
    panel.Children.Add(edit);
    panel.Children.Add(dialog);
    panel.Children.Add(refresh);
    Window window = new Window { Content = panel };
    window.Activate();
  }
}`;
let compiled;
function program() {
  if (!compiled) {
    compiled = compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  }
  return compiled;
}
const engines = {
  source: value => new VirtualMachine(value.image, {virtualTime: true}),
  reload: value => new VirtualMachine(loadAssembly(value.assembly), {virtualTime: true}),
  cil: value => new CilVirtualMachine(value.assembly, {virtualTime: true})
};
const node = (vm, name) => vm.platform.scene().nodes.find(value => value.properties.Name === name);
const reference = (vm, name) => vm.platform.ui.reference(node(vm, name).id);
const tick = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

async function pumpUntil(vm, condition, {advance = false} = {}) {
  for (let turn = 0; turn < 256; turn++) {
    if (condition()) return;
    if (['running', 'ready', 'waiting'].includes(vm.state)) vm.runSlice({instructionBudget: 2048, timeBudgetMs: 8});
    if (vm.state === 'faulted') throw vm.fault;
    await tick();
    if (advance && vm.state === 'waiting') {
      const delay = vm.scheduler.nextDelay();
      if (delay !== null) vm.scheduler.advance(delay);
    }
  }
  assert.fail('Managed event request did not reach its expected bounded execution state');
}
function observe(promise) {
  const state = {settled: false, value: null, error: null};
  promise.then(value => { state.value = value; state.settled = true; }, error => { state.error = error; state.settled = true; });
  return state;
}

for (const [engine, create] of Object.entries(engines)) {
  test(engine + ': managed text decisions finish before the proposed input is committed', async () => {
    const vm = create(program());
    try {
      const initial = await vm.runAsync();
      assert.equal(initial.state, 'terminated', initial.fault?.message);
      const request = vm.platform.ui.requestEvent(reference(vm, 'edit'), 'BeforeTextChanging', {NewText: 'blocked', Cancel: false});
      const state = observe(request);
      await pumpUntil(vm, () => state.settled);
      assert.equal(state.error, null);
      assert.equal(state.value.Cancel, true);
      assert.equal(state.value.NewText, 'blocked');
      assert.equal(node(vm, 'edit').properties.Text, 'original');
      assert.equal(vm.platform.ui.eventRequests.pending.size, 0);
      assert.equal(vm.scheduler.completions.count, 0);
      await assert.rejects(vm.platform.ui.requestEvent(reference(vm, 'edit'), 'NotAnEvent'), /Unregistered UI event/);
      await assert.rejects(vm.platform.ui.requestEvent(reference(vm, 'edit'), 'BeforeTextChanging', []), /object data/);
      vm.platform.ui.write(reference(vm, 'edit'), 'IsEnabled', false);
      await assert.rejects(vm.platform.ui.requestEvent(reference(vm, 'edit'), 'BeforeTextChanging'), /does not accept input/);
    } finally { vm.stop(); }
  });

  test(engine + ': ordered async-void callbacks acquire real deferrals and resume on the UI dispatcher', async () => {
    const vm = create(program());
    try {
      await vm.runAsync();
      const request = vm.platform.ui.requestEvent(reference(vm, 'dialog'), 'PrimaryButtonClick', {Cancel: false});
      const state = observe(request);
      await pumpUntil(vm, () => node(vm, 'label').properties.Text === 'prefix|second');
      await tick();
      assert.equal(state.settled, false);
      const entry = [...vm.platform.ui.eventRequests.pending][0];
      assert.equal(entry.deferrals, 1);
      assert.equal(entry.group.sealed, true);
      const args = [...entry.arguments.values()][0];
      vm.heap.collect();
      assert.equal(vm.platform.ui.isAlive(args), true);
      const child = [...vm.scheduler.contexts.values()].find(value => value.kind === 'async' && value.status === 'waiting');
      assert.ok(child, 'async body is waiting on its managed Task.Delay');
      assert.equal(child.dispatcherThread, 'ui');
      assert.equal(vm.scheduler.snapshot().contexts.find(([id]) => id === child.id)[1].dispatcherThread, 'ui');
      await pumpUntil(vm, () => state.settled, {advance: true});
      assert.equal(state.error, null);
      assert.equal(state.value.Cancel, true);
      assert.equal(node(vm, 'label').properties.Text, 'completed');
      assert.equal(vm.platform.ui.eventRequests.pending.size, 0);
      assert.equal(vm.scheduler.completions.count, 0);
      vm.heap.collect();
      assert.equal(vm.platform.ui.isAlive(args), false, 'completed decisions do not retain argument wrappers');
    } finally { vm.stop(); }
  });

  test(engine + ': cancellation and rewind release held event arguments and never resurrect external decisions', async () => {
    const vm = create(program());
    try {
      await vm.runAsync();
      const before = vm.snapshot(), controller = new AbortController();
      const request = vm.platform.ui.requestEvent(reference(vm, 'refresh'), 'RefreshRequested', {}, {signal: controller.signal});
      const state = observe(request);
      await pumpUntil(vm, () => [...vm.platform.ui.eventRequests.pending].some(entry => entry.group.sealed));
      const entry = [...vm.platform.ui.eventRequests.pending][0], args = [...entry.arguments.values()][0];
      vm.heap.collect();
      assert.equal(vm.platform.ui.isAlive(args), true);
      controller.abort(new Error('newer refresh replaced this request'));
      await pumpUntil(vm, () => state.settled);
      assert.match(state.error.message, /replaced/);
      assert.equal(vm.platform.ui.eventRequests.pending.size, 0);
      vm.heap.collect();
      assert.equal(vm.platform.ui.isAlive(args), false);
      const next = observe(vm.platform.ui.requestEvent(reference(vm, 'refresh'), 'RefreshRequested'));
      await pumpUntil(vm, () => [...vm.platform.ui.eventRequests.pending].some(value => value.group.sealed));
      vm.restore(before);
      await tick();
      assert.equal(next.settled, true);
      assert.match(next.error.message, /rewound/);
      assert.equal(vm.platform.ui.eventRequests.pending.size, 0);
      assert.equal(vm.scheduler.completions.count, 0);
      vm.state = 'terminated';
      const final = observe(vm.platform.ui.requestEvent(reference(vm, 'refresh'), 'RefreshRequested'));
      await pumpUntil(vm, () => [...vm.platform.ui.eventRequests.pending].some(value => value.group.sealed));
      vm.stop();
      await tick();
      assert.equal(final.settled, true);
      assert.match(final.error.message, /ended|canceled/);
    } finally { vm.stop(); }
  });
}

test('ordinary task and thread contexts do not acquire dispatcher access from an unrelated UI request', () => {
  const scheduler = {currentId: 42, current: {kind: 'task', dispatcherThread: null}};
  const queue = new ManagedUIWorkQueue({platform: {vm: {scheduler}}});
  assert.equal(queue.currentThread(), 42);
  scheduler.current = {kind: 'thread', dispatcherThread: null};
  assert.equal(queue.currentThread(), 42);
  scheduler.current = {kind: 'async', dispatcherThread: 'ui'};
  assert.equal(queue.currentThread(), 'ui');
  scheduler.current = {kind: 'async', dispatcherThread: null};
  assert.equal(queue.currentThread(), 42);
  queue.dispose();
});
