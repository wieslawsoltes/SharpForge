import test from 'node:test';
import assert from 'node:assert/strict';
import {UIExtensionRegistry} from '@sharpforge/winui-properties';
import {registerValueAdapters} from '../packages/winui-controls/src/values/adapters.js';
import {applyControlFamilyInput} from '../packages/winui-controls/src/policy/family-input.js';
import {managedFamilyContext} from './helpers/a16-managed-context.js';

const controls = 'Microsoft.UI.Xaml.Controls.';

function fixture(type) {
  const context = managedFamilyContext();
  const registry = new UIExtensionRegistry();
  registerValueAdapters(registry);
  const owner = context.allocate(controls + type);
  const write = context.write;
  context.write = (receiver, name, value) => {
    if (name === 'DateValue' || name === 'TimeValue') assert.notEqual(value, null, 'non-nullable companion cannot receive null');
    return write(receiver, name, value);
  };
  const set = (name, value) => registry.invoke(context,
    {owner: controls + type, name: 'set_' + name, kind: 'set'}, owner, [value]);
  return {context, owner, set};
}

test('clearing DatePicker.SelectedDate retains its typed date companion and emits nullable old/new values', () => {
  const {context, owner, set} = fixture('DatePicker');
  const date = context.allocate('System.DateTimeOffset', {UnixTimeMilliseconds: Date.UTC(2024, 1, 29), Year: 2024, Month: 2, Day: 29});
  set('SelectedDate', date);
  const retained = context.read(owner, 'DateValue');
  assert.equal(context.events.at(-1).payload.OldDate, null);
  set('SelectedDate', null);
  assert.equal(context.read(owner, 'SelectedDate'), null);
  assert.equal(context.read(owner, 'DateValue'), retained);
  assert.equal(context.read(owner, 'Date'), retained);
  assert.equal(context.native(context.events.at(-1).payload.OldDate).Day, 29);
  assert.equal(context.events.at(-1).payload.NewDate, null);
  applyControlFamilyInput(context, owner, 'SelectedDateChanged', {NewDate: null, DateValue: date});
  assert.equal(context.read(owner, 'SelectedDate'), null, 'explicit absent value must beat stale companion payload');
  assert.equal(context.read(owner, 'DateValue'), retained);
});

test('present midnight and absent TimePicker.SelectedTime remain distinct without clearing TimeValue', () => {
  const {context, owner, set} = fixture('TimePicker');
  const midnight = context.allocate('System.TimeSpan', {TotalMilliseconds: 0, TotalSeconds: 0});
  set('SelectedTime', midnight);
  const retained = context.read(owner, 'TimeValue');
  assert.equal(context.native(context.read(owner, 'SelectedTime')).TotalMilliseconds, 0);
  assert.equal(context.events.at(-1).payload.OldTime, null);
  set('SelectedTime', null);
  assert.equal(context.read(owner, 'SelectedTime'), null);
  assert.equal(context.read(owner, 'TimeValue'), retained);
  assert.equal(context.events.at(-1).payload.NewTime, null);
  applyControlFamilyInput(context, owner, 'SelectedTimeChanged', {NewTime: null, value: midnight});
  assert.equal(context.read(owner, 'SelectedTime'), null);
  assert.equal(context.read(owner, 'TimeValue'), retained);
});
