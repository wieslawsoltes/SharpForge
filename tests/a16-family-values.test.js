import test from 'node:test';
import assert from 'node:assert/strict';
import { NumericRange, CultureNumberFormatter } from '../packages/winui-controls/src/values/range.js';
import { evaluateNumericExpression } from '../packages/winui-controls/src/values/expression.js';
import { CalendarModel, dateValue, dateText, timeValue } from '../packages/winui-controls/src/values/calendar.js';
import { dateFieldOrder, dateFromFields } from '../packages/winui-controls/src/values/date-fields.js';
import { colorFromHex, colorToHex, rgbToHsv, hsvToRgb, constrainHsv } from '../packages/winui-controls/src/values/color.js';
import { defaultItemHeight } from '../packages/winui-controls/src/items/item-source.js';

test('number expressions use bounded arithmetic with normal precedence and no evaluation escape', () => {
  assert.equal(evaluateNumericExpression('2 + 3 * 4'), 14);
  assert.equal(evaluateNumericExpression('-2^2'), -4);
  assert.equal(evaluateNumericExpression('2^3^2'), 512);
  for (const text of ['globalThis.process', '1;throw 1', 'Math.random()', '1/0', '1e999', '', '2(3)']) {
    assert.throws(() => evaluateNumericExpression(text), error => error.code === 'SFUI1684');
  }
  assert.throws(() => evaluateNumericExpression('('.repeat(40) + '1' + ')'.repeat(40)), error => error.code === 'SFUI1684');
});

test('number cultures normalize decimal, grouping, Arabic digits and blank NaN', () => {
  assert.equal(new CultureNumberFormatter('de-DE').parse('1.234,5'), 1234.5);
  assert.equal(new CultureNumberFormatter('en-US').parse('1,234.5'), 1234.5);
  assert.equal(new CultureNumberFormatter('ar-EG').parse('١٢٣٫٥'), 123.5);
  assert.equal(Number.isNaN(new CultureNumberFormatter().parse('')), true);
  assert.throws(() => new CultureNumberFormatter().parse('12apples'), error => error.code === 'SFUI1683');
});

test('range clamps, wraps, distinguishes NaN and restores without duplicate events', () => {
  const model = new NumericRange({ minimum: 10, maximum: 20, value: 99, smallChange: 2, wrap: true });
  assert.equal(model.value, 20);
  model.step(1);
  assert.equal(model.value, 10);
  model.step(-1);
  assert.equal(model.value, 20);
  const snapshot = model.snapshot();
  let changes = 0;
  model.on('ValueChanged', () => changes++);
  model.set(NaN);
  model.set(NaN);
  assert.equal(changes, 1);
  model.restore(snapshot);
  assert.equal(changes, 1);
  assert.equal(model.value, 20);
  assert.throws(() => new NumericRange({ minimum: 2, maximum: 1 }), error => error.code === 'SFUI1680');
  assert.throws(() => new NumericRange({ smallChange: Infinity }), error => error.code === 'SFUI1681');
});

test('Gregorian calendar leap days, week origins, boundaries and blackouts remain UTC-stable', () => {
  const model = new CalendarModel({ displayDate: '2024-02-15', firstDayOfWeek: 1,
    minimum: '2024-02-01', maximum: '2024-02-29', selectionMode: 2 });
  const days = model.days();
  assert.equal(days.length, 42);
  assert.equal(new Date(days[0].date).getUTCDay(), 1);
  assert.equal(days.filter(day => day.inMonth).length, 29);
  assert.equal(model.select('2024-01-31'), false);
  model.blackoutDates.add(dateValue('2024-02-12'));
  assert.equal(model.select('2024-02-12'), false);
  model.select('2024-02-13');
  model.select('2024-02-14');
  const snapshot = model.snapshot();
  model.select('2024-02-13', { toggle: true });
  model.restore(snapshot);
  assert.equal(model.selectedDates.size, 2);
  assert.throws(() => new CalendarModel({ calendar: 'HijriCalendar' }), error => error.code === 'SFUI1686');
  assert.throws(() => dateValue(1e300), error => error.code === 'SFUI1685');
});

test('date picker fields follow culture and clamp invalid month-end dates', () => {
  assert.deepEqual(dateFieldOrder('en-US'), ['month', 'day', 'year']);
  assert.deepEqual(dateFieldOrder('de-DE'), ['day', 'month', 'year']);
  assert.deepEqual(dateFieldOrder('ja-JP'), ['year', 'month', 'day']);
  assert.equal(dateText(dateFromFields({ year: 2024, month: 2, day: 31 })), '2024-02-29');
  assert.equal(dateText(dateFromFields({ year: 1, month: 1, day: 1 })), '0001-01-01');
  assert.throws(() => dateFromFields({ year: 2024, month: 13, day: 1 }), error => error.code === 'SFUI1685');
});

test('time values snap in minutes and reject invalid day and increment boundaries', () => {
  assert.equal(timeValue('23:59', 15), (23 * 60 + 45) * 60_000);
  assert.equal(timeValue({ TotalMilliseconds: 0 }), 0);
  assert.equal(timeValue('12:00', 30), 43_200_000);
  for (const value of ['24:00', '12:60', -1, 86_400_000, Infinity]) {
    assert.throws(() => timeValue(value), error => error.code === 'SFUI1687');
  }
  assert.throws(() => timeValue('12:00', 0), error => error.code === 'SFUI1687');
});

test('RGB, HSV and ARGB conversion preserve byte values and alpha through edits', () => {
  const samples = ['#FFFF0000', '#8000FF00', '#000000FF', '#FF808080', '#FF4A79C6'];
  for (const text of samples) {
    const color = colorFromHex(text);
    assert.equal(colorToHex(color, true), text);
    const restored = hsvToRgb(rgbToHsv(color), color.A);
    assert.deepEqual(restored, color);
  }
  assert.deepEqual(colorFromHex('#FFFFFF', 128), { A: 128, R: 255, G: 255, B: 255 });
  assert.deepEqual(constrainHsv({ H: 300, S: 20, V: 60 }, { MaxHue: 200, MinSaturation: 30 }), { H: 200, S: 30, V: 60 });
  assert.throws(() => colorFromHex('#GG0011'), error => error.code === 'SFUI1689');
  assert.throws(() => hsvToRgb({ H: NaN, S: 0, V: 0 }), error => error.code === 'SFUI1689');
  assert.throws(() => constrainHsv({ H: 0, S: 0, V: 0 }, { MinHue: 300, MaxHue: 200 }), error => error.code === 'SFUI1689');
});

test('automatic list/tree extent uses the touch minimum while explicit app sizes remain explicit', () => {
  const node = { properties: { ItemHeight: 0 } };
  assert.equal(defaultItemHeight({ services: { environment: { TouchMode: false } } }, node), 32);
  assert.equal(defaultItemHeight({ services: { environment: { TouchMode: true } } }, node), 40);
  node.properties.ItemHeight = 24;
  assert.equal(defaultItemHeight({ services: { environment: { TouchMode: true } } }, node), 24);
});
