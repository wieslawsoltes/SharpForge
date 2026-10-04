import { NumericRange, CultureNumberFormatter } from './range.js';
import { evaluateNumericExpression } from './expression.js';
import { CalendarModel, dateValue, dateText, timeValue } from './calendar.js';
import { CONTROLS as C, read, registerMethod, registerGet, registerSet } from '../policy/adapter-helpers.js';

export function managedRange(context, receiver) {
  const model = context.state(receiver, 'family.range', () => {
    const value = new NumericRange({ minimum: read(context, receiver, 'Minimum', 0), maximum: read(context, receiver, 'Maximum', 100),
      value: read(context, receiver, 'Value', 0) });
    value.on('ValueChanged', args => { context.write(receiver, 'Value', value.value); context.emit(receiver, 'ValueChanged', args); });
    return value;
  });
  model.minimum = read(context, receiver, 'Minimum', 0); model.maximum = read(context, receiver, 'Maximum', 100);
  model.smallChange = read(context, receiver, 'SmallChange', 1); model.largeChange = read(context, receiver, 'LargeChange', 10);
  model.wrap = read(context, receiver, 'IsWrapEnabled', false); model.validate();
  model.set(read(context, receiver, 'Value', 0));
  return model;
}

export function managedDate(context, value, normalize = true) {
  if (value == null) return null;
  const timestamp = normalize ? dateValue(value) : Number(value);
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new RangeError('DateTimeOffset is outside the supported date range');
  return context.allocate('System.DateTimeOffset', { UnixTimeMilliseconds: timestamp,
    Year: date.getUTCFullYear(), Month: date.getUTCMonth() + 1, Day: date.getUTCDate() });
}

export function managedCalendar(context, receiver) {
  const value = context.state(receiver, 'family.calendar', () => {
    const model = new CalendarModel({ minimum: read(context, receiver, 'MinDate') ?? read(context, receiver, 'MinYear') ?? undefined,
      maximum: read(context, receiver, 'MaxDate') ?? read(context, receiver, 'MaxYear') ?? undefined,
      calendar: read(context, receiver, 'CalendarIdentifier', 'GregorianCalendar'),
      firstDayOfWeek: read(context, receiver, 'FirstDayOfWeek', 0), selectionMode: read(context, receiver, 'SelectionMode', 1),
      locale: context.services.resources?.language ?? 'en-US' });
    model.on('SelectedDatesChanged', args => {
      if (!context.typeOf(receiver).endsWith('CalendarView')) return;
      context.write(receiver, 'SelectedDates', context.collection([...model.selectedDates].map(value => managedDate(context, value)), C + 'ItemCollection'));
      context.emit(receiver, 'SelectedDatesChanged', { AddedDates: args.AddedDates.map(value => managedDate(context, value)),
        RemovedDates: args.RemovedDates.map(value => managedDate(context, value)) });
    });
    return model;
  });
  value.configure({ minimum: read(context, receiver, 'MinDate') ?? read(context, receiver, 'MinYear') ?? undefined,
    maximum: read(context, receiver, 'MaxDate') ?? read(context, receiver, 'MaxYear') ?? undefined,
    calendar: read(context, receiver, 'CalendarIdentifier', 'GregorianCalendar'),
    firstDayOfWeek: read(context, receiver, 'FirstDayOfWeek', 0), selectionMode: read(context, receiver, 'SelectionMode', 1),
    locale: read(context, receiver, 'Language', context.services.resources?.language ?? 'en-US') });
  return value;
}

function setDate(context, receiver, value) {
  const type = context.typeOf(receiver);
  const calendarPicker = type.endsWith('CalendarDatePicker');
  const model = managedCalendar(context, receiver);
  const previous = calendarPicker ? read(context, receiver, 'Date') || null
    : type.endsWith('CalendarView') ? model.selectedDates.values().next().value ?? null : read(context, receiver, 'SelectedDate');
  const next = context.native(value);
  if (next != null && !model.select(next)) return;
  if (next == null) model.selectedDates.clear();
  const date = next == null ? null : managedDate(context, next);
  if (date != null) context.write(receiver, 'DateValue', date);
  if (calendarPicker) context.write(receiver, 'Date', next == null ? '' : dateText(next));
  else if (!type.endsWith('CalendarView')) {
    if (date != null) context.write(receiver, 'Date', date);
    context.write(receiver, 'SelectedDate', date);
  }
  context.emit(receiver, 'SelectedDateChanged', { OldDate: previous == null ? null : managedDate(context, previous), NewDate: date });
}

export function registerValueAdapters(registry) {
  registerSet(registry, C + 'InfoBar', 'IsOpen', (context, receiver, value) => {
    const open = !!context.native(value), previous = read(context, receiver, 'IsOpen', false);
    if (open === previous) return;
    if (!open) {
      const args = { Cancel: false, Reason: 1 };
      context.emit(receiver, 'Closing', args);
      if (args.Cancel) return;
    }
    context.write(receiver, 'IsOpen', open);
    if (!open) context.emit(receiver, 'Closed', { Reason: 1 });
  });
  for (const name of ['NumberBox', 'Slider', 'ProgressBar', 'ProgressRing', 'Primitives.RangeBase']) {
    registerSet(registry, C + name, 'Value', (c, r, value) => managedRange(c, r).set(Number(c.native(value))));
    registerGet(registry, C + name, 'Value', (c, r) => managedRange(c, r).value);
    for (const property of ['Minimum', 'Maximum', 'SmallChange', 'LargeChange']) registerSet(registry, C + name, property, (c, r, value) => {
      const model = managedRange(c, r), key = property[0].toLowerCase() + property.slice(1), previous = model[key];
      model[key] = Number(c.native(value));
      try { model.validate(); } catch (error) { model[key] = previous; throw error; }
      c.write(r, property, model[key]); model.set(model.value);
    });
  }
  registerSet(registry, C + 'NumberBox', 'Text', (c, r, value) => {
    const text = String(c.native(value)), formatter = new CultureNumberFormatter(c.services.resources?.language ?? 'en-US');
    const number = read(c, r, 'AcceptsExpression', false) && text.trim()
      ? evaluateNumericExpression(formatter.normalize(text)) : formatter.parse(text);
    managedRange(c, r).set(number); c.write(r, 'Text', formatter.format(number));
  });
  registerMethod(registry, 'System.DateTimeOffset', 'FromUnixTimeMilliseconds',
    (c, r, args) => managedDate(c, Number(c.native(args[0])), false));
  registerMethod(registry, 'System.DateTimeOffset', 'ToUnixTimeMilliseconds', (c, r) => c.managed(read(c, r, 'UnixTimeMilliseconds', 0), 'long'));
  for (const name of ['DatePicker', 'CalendarDatePicker', 'DatePickerFlyout', 'CalendarView']) {
    registerMethod(registry, C + name, 'SetDate', (c, r, args) => setDate(c, r, args[0]));
    registerMethod(registry, C + name, 'GetDate', (c, r) => managedDate(c, read(c, r, 'DateValue')));
    registerSet(registry, C + name, 'DateValue', setDate);
    if (name === 'DatePicker' || name === 'DatePickerFlyout') {
      registerSet(registry, C + name, 'Date', setDate);
      registerSet(registry, C + name, 'SelectedDate', setDate);
    }
  }
  registerMethod(registry, C + 'CalendarView', 'SetDisplayDate', (c, r, args) => {
    managedCalendar(c, r).setDisplayDate(c.native(args[0])); c.write(r, 'DisplayDate', args[0]);
  });
  for (const name of ['TimePicker', 'TimePickerFlyout']) {
    const set = (c, r, value) => {
      if (c.native(value) == null) {
        const previous = c.read(r, 'SelectedTime');
        c.write(r, 'SelectedTime', null);
        c.emit(r, 'SelectedTimeChanged', { OldTime: previous, NewTime: null });
        return;
      }
      const previous = read(c, r, 'SelectedTime'), milliseconds = timeValue(c.native(value), read(c, r, 'MinuteIncrement', 1));
      const time = c.allocate('System.TimeSpan', { TotalMilliseconds: milliseconds, TotalSeconds: milliseconds / 1000 });
      c.write(r, 'TimeValue', time); c.write(r, 'SelectedTime', time);
      if (name === 'TimePicker') c.write(r, 'Time', String(Math.floor(milliseconds / 3_600_000)).padStart(2, '0') + ':'
        + String(Math.floor(milliseconds / 60_000) % 60).padStart(2, '0'));
      c.emit(r, 'SelectedTimeChanged', { OldTime: previous, NewTime: time });
    };
    registerMethod(registry, C + name, 'SetTime', (c, r, args) => set(c, r, args[0]));
    registerSet(registry, C + name, 'TimeValue', set); registerSet(registry, C + name, 'SelectedTime', set);
    registerMethod(registry, C + name, 'GetTime', (c, r) => c.read(r, 'TimeValue'));
  }
}
