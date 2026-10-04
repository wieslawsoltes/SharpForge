import { managedCalendar, managedDate } from './adapters.js';
import { dateValue, dateText, timeValue } from './calendar.js';
import { CONTROLS as C, read } from '../policy/adapter-helpers.js';
import { ControlError } from '../policy/events.js';

/** Native event projections update the same models used by synchronous managed getters. */
export function applyValueInput(context, receiver, type, event, payload, emit) {
  if (type === 'CalendarDatePicker' && (event === 'Opened' || event === 'Closed')) {
    context.write(receiver, 'IsCalendarOpen', event === 'Opened');
    return true;
  }
  if (type === 'CalendarView' && event === 'SelectedDatesChanged') {
    const model = managedCalendar(context, receiver);
    const update = () => {
      for (const value of payload.RemovedDates ?? []) model.selectedDates.delete(dateValue(context.native(value)));
      for (const value of payload.AddedDates ?? []) model.select(context.native(value));
    };
    if (emit) update();
    else model.silence(update);
    const dates = [...model.selectedDates].map(value => managedDate(context, value));
    context.write(receiver, 'SelectedDates', context.collection(dates, C + 'ItemCollection'));
    return true;
  }
  if (['DatePicker', 'DatePickerFlyout', 'CalendarDatePicker'].includes(type)
    && ['SelectedDateChanged', 'DateChanged'].includes(event)) {
    const model = managedCalendar(context, receiver);
    const value = context.native(Object.hasOwn(payload, 'NewDate') ? payload.NewDate : payload.DateValue ?? payload.value ?? null);
    const accepted = () => value == null ? (model.selectedDates.clear(), true) : model.select(value);
    if (!(emit ? accepted() : model.silence(accepted))) return true;
    const date = value == null ? null : managedDate(context, value);
    if (date != null) context.write(receiver, 'DateValue', date);
    if (type === 'CalendarDatePicker') context.write(receiver, 'Date', value == null ? '' : dateText(value));
    else {
      context.write(receiver, 'SelectedDate', date);
      if (date != null) context.write(receiver, 'Date', date);
    }
    return true;
  }
  if (['TimePicker', 'TimePickerFlyout'].includes(type) && ['TimeChanged', 'SelectedTimeChanged'].includes(event)) {
    const value = context.native(Object.hasOwn(payload, 'NewTime') ? payload.NewTime : payload.value);
    if (value == null) { context.write(receiver, 'SelectedTime', null); return true; }
    const milliseconds = timeValue(value, read(context, receiver, 'MinuteIncrement', 1));
    const time = context.allocate('System.TimeSpan', { TotalMilliseconds: milliseconds, TotalSeconds: milliseconds / 1000 });
    context.write(receiver, 'TimeValue', time);
    context.write(receiver, 'SelectedTime', time);
    if (type === 'TimePicker') context.write(receiver, 'Time', String(Math.floor(milliseconds / 3_600_000)).padStart(2, '0') + ':'
      + String(Math.floor(milliseconds / 60_000) % 60).padStart(2, '0'));
    return true;
  }
  if (type === 'RatingControl' && event === 'ValueChanged') {
    if (read(context, receiver, 'IsReadOnly', false)) return true;
    const value = Number(payload.NewValue ?? payload.value);
    if (!Number.isFinite(value)) throw new ControlError('SFUI1682', 'Rating must be finite');
    const rating = value < 0 ? -1 : Math.max(0, Math.min(read(context, receiver, 'MaxRating', 5), value));
    context.write(receiver, 'Value', rating);
    payload.NewValue = payload.value = rating;
    return true;
  }
  if (type === 'ColorPicker' && event === 'ColorChanged') {
    const color = payload.NewColor;
    if (!color || ['A', 'R', 'G', 'B'].some(key => !Number.isInteger(color[key]) || color[key] < 0 || color[key] > 255)) {
      throw new ControlError('SFUI1682', 'Color channels must be bytes');
    }
    context.write(receiver, 'Color', color);
    return true;
  }
  if (type === 'InfoBar' && event === 'Closed') {
    context.write(receiver, 'IsOpen', false);
    return true;
  }
  return false;
}
