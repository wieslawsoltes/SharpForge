import { CalendarModel, dateText, dateValue, timeValue } from './calendar.js';
import { createPart, controlName, registerFamily, stateFor, emitChange, ControlEvents, ControlError } from '../policy/events.js';
import { renderDateFields, selectedDateFields } from './date-fields.js';
import { showControlOverlay, hideControlOverlay, overlayManager } from '../overlay/index.js';

export function getCalendarModel(context, node) {
  const model = stateFor(context, node, 'calendar', () => new CalendarModel({ displayDate: node.properties.DateValue ?? node.properties.DisplayDate
    ?? (node.properties.Date || null)
    ?? context.services?.clock?.today?.() ?? Date.UTC(2000, 0, 1), locale: node.properties.Language ?? 'en-US',
  minimum: node.properties.MinDate ?? node.properties.MinYear, maximum: node.properties.MaxDate ?? node.properties.MaxYear,
  firstDayOfWeek: node.properties.FirstDayOfWeek ?? 0, calendar: node.properties.CalendarIdentifier ?? 'GregorianCalendar' }));
  model.configure({ minimum: node.properties.MinDate ?? node.properties.MinYear,
    maximum: node.properties.MaxDate ?? node.properties.MaxYear, firstDayOfWeek: node.properties.FirstDayOfWeek,
    selectionMode: node.properties.SelectionMode, calendar: node.properties.CalendarIdentifier,
    locale: node.properties.Language });
  return model;
}

function renderCalendar(context, node, element) {
  const model = getCalendarModel(context, node);
  const [label, previous, next, days] = element.children;
  const dateProperty = node.properties.DisplayDate ?? node.properties.DateValue;
  if (dateProperty != null && model.lastDateProperty !== dateProperty) {
    model.setDisplayDate(dateProperty); model.lastDateProperty = dateProperty;
  }
  const selected = node.collections.SelectedDates;
  if (selected && model.lastSelected !== selected) { model.selectedDates = new Set(selected.map(dateValue)); model.lastSelected = selected; }
  label.textContent = model.label();
  model.selectionMode = node.properties.SelectionMode ?? 1;
  days.setAttribute('role', 'grid');
  Object.assign(days.style, { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' });
  if (model.displayMode) { renderCalendarPeriods(context, node, element, model); return; }
  const items = model.days(node.properties.NumberOfWeeksInView ?? 6);
  const dateFormatter = new Intl.DateTimeFormat(model.locale, { dateStyle: 'full', timeZone: 'UTC' });
  const children = items.map((day, index) => {
    const element = days.children[index] ?? createPart(context.document, 'button', 'calendar-day');
    delete element.dataset.period;
    element.dataset.date = String(day.date);
    const changing = { Item: { Date: day.date, IsBlackout: day.isBlackout }, Date: dateRecord(day.date), IsBlackout: day.isBlackout, Phase: 0 };
    if (controlName(node) === 'CalendarView') context.emit(node, 'CalendarViewDayItemChanging', changing);
    element.disabled = changing.IsBlackout || changing.Item.IsBlackout;
    element.textContent = String(day.day);
    element.setAttribute('role', 'gridcell');
    element.setAttribute('aria-selected', String(day.selected));
    element.setAttribute('aria-label', dateFormatter.format(day.date));
    element.tabIndex = day.date === (model.focusedDate ?? model.displayDate) ? 0 : -1;
    element.style.opacity = day.inMonth ? '' : '0.5';
    return element;
  });
  context.ordered(days, children);
}

function dateRecord(value) {
  const date = new Date(value);
  return { UnixTimeMilliseconds: value, Year: date.getUTCFullYear(), Month: date.getUTCMonth() + 1, Day: date.getUTCDate() };
}

function renderCalendarPeriods(context, node, element, model) {
  const date = new Date(model.displayDate), year = date.getUTCFullYear(), decade = Math.floor(year / 10) * 10;
  const [label, , , days] = element.children;
  label.textContent = model.displayMode === 1 ? String(year) : `${decade}–${decade + 9}`;
  days.style.gridTemplateColumns = 'repeat(4, minmax(0, 1fr))';
  const formatter = new Intl.DateTimeFormat(model.locale, { month: 'short', timeZone: 'UTC' });
  const items = [];
  for (let index = 0; index < 12; index++) {
    const value = new Date(model.displayDate); value.setUTCDate(1);
    if (model.displayMode === 1) value.setUTCMonth(index);
    else value.setUTCFullYear(decade - 1 + index, 0, 1);
    const button = days.children[index] ?? createPart(context.document, 'button', 'calendar-period');
    delete button.dataset.date; button.dataset.period = String(value.getTime());
    button.textContent = model.displayMode === 1 ? formatter.format(value) : String(value.getUTCFullYear());
    button.disabled = value.getTime() > model.maximum || value.getUTCFullYear() < new Date(model.minimum).getUTCFullYear();
    items.push(button);
  }
  context.ordered(days, items);
}

function calendarEvent(context, node, element, event) {
  if (node.properties.IsEnabled === false || event.target.disabled) return false;
  const model = getCalendarModel(context, node);
  if (event.type === 'keydown') return calendarKey(context, node, element, event, model);
  if (event.target.dataset.part === 'calendar-previous') model.moveMonth(model.displayMode === 2 ? -120 : model.displayMode === 1 ? -12 : -1);
  else if (event.target.dataset.part === 'calendar-next') model.moveMonth(model.displayMode === 2 ? 120 : model.displayMode === 1 ? 12 : 1);
  else if (event.target.dataset.part === 'calendar-title') model.displayMode = Math.min(2, model.displayMode + 1);
  else if (event.target.dataset.period) { model.setDisplayDate(Number(event.target.dataset.period)); model.displayMode--; }
  else if (event.target.dataset.date && event.type === 'click') {
    const date = Number(event.target.dataset.date);
    const previous = [...model.selectedDates];
    if (model.select(date, { toggle: model.selectionMode === 2 })) {
      node.properties.Date = dateText(date);
      node.properties.DateValue = dateRecord(date);
      node.properties.SelectedDate = date;
      node.collections.SelectedDates = [...model.selectedDates];
      const before = new Set(previous), current = model.selectedDates;
      const added = [...current].filter(value => !before.has(value)), removed = previous.filter(value => !current.has(value));
      if (controlName(node) === 'CalendarView') context.emit(node, 'SelectedDatesChanged',
        { AddedDates: added.map(dateRecord), RemovedDates: removed.map(dateRecord) });
      context.emit(node, 'SelectedDateChanged', { OldDate: previous.length ? dateRecord(previous[0]) : null, NewDate: dateRecord(date) });
      if (controlName(node) === 'CalendarDatePicker') context.emit(node, 'DateChanged',
        { OldDate: previous[0] ?? null, NewDate: date, value: node.properties.Date });
    }
  } else return false;
  context.invalidate(node.id);
  return true;
}

function calendarKey(context, node, element, event, model) {
  const steps = { ArrowLeft: node.properties.FlowDirection === 1 ? 1 : -1,
    ArrowRight: node.properties.FlowDirection === 1 ? -1 : 1, ArrowUp: -7, ArrowDown: 7 };
  const current = Number(event.target.dataset.date ?? model.focusedDate ?? model.displayDate);
  let date = current;
  if (Object.hasOwn(steps, event.key)) date += steps[event.key] * 86_400_000;
  else if (event.key === 'Home') { const value = new Date(date); value.setUTCDate(1); date = value.getTime(); }
  else if (event.key === 'End') { const value = new Date(date); value.setUTCMonth(value.getUTCMonth() + 1, 0); date = value.getTime(); }
  else if (event.key === 'PageUp' || event.key === 'PageDown') {
    const value = new Date(date); value.setUTCMonth(value.getUTCMonth() + (event.key === 'PageUp' ? -1 : 1)); date = value.getTime();
  } else return false;
  event.preventDefault(); model.focusedDate = Math.max(model.minimum, Math.min(model.maximum, date));
  model.setDisplayDate(model.focusedDate); renderCalendar(context, node, element);
  element.querySelector(`[data-date="${model.focusedDate}"]`)?.focus(); context.invalidate(node.id); return true;
}

function createCalendar(context) {
  const root = context.document.createElement('div');
  const previous = createPart(context.document, 'button', 'calendar-previous');
  const next = createPart(context.document, 'button', 'calendar-next');
  previous.textContent = '‹'; next.textContent = '›';
  previous.setAttribute('aria-label', 'Previous month'); next.setAttribute('aria-label', 'Next month');
  root.append(createPart(context.document, 'button', 'calendar-title'), previous, next, createPart(context.document, 'div', 'calendar-days'));
  return root;
}

export function registerCalendarRenderers(registry) {
  registerFamily(registry, 'CalendarView', { create: createCalendar, render: renderCalendar, events: { click: calendarEvent, keydown: calendarEvent } });
  registerFamily(registry, 'CalendarDatePicker', {
    create: createCalendarPicker, render: renderCalendarPicker,
    events: { click: calendarPickerEvent, keydown: calendarPickerEvent }
  });
  registerFamily(registry, ['DatePicker', 'DatePickerFlyout'], {
    create(context) { return createPart(context.document, 'div', 'date-picker-fields'); },
    render(context, node, element) { renderDateFields(context, node, element, getCalendarModel(context, node)); },
    invoke: pickerInvoke,
    events: { change(context, node, element) {
      if (node.properties.IsEnabled === false) return false;
      const model = getCalendarModel(context, node);
      const value = selectedDateFields(element, model);
      const previous = node.properties.DateValue;
      if (value != null && !model.select(value)) return false;
      const date = value == null ? null : dateRecord(value);
      if (date != null) node.properties.DateValue = date;
      node.properties.Date = date;
      node.properties.SelectedDate = date;
      context.emit(node, 'SelectedDateChanged', { OldDate: previous, NewDate: date });
      context.invalidate(node.id);
      return true;
    } }
  });
  registerFamily(registry, ['TimePicker', 'TimePickerFlyout'], {
    create(context) {
      const root = context.document.createElement('div');
      const hour = createPart(context.document, 'input', 'time-hour');
      const minute = createPart(context.document, 'input', 'time-minute');
      const period = createPart(context.document, 'select', 'time-period');
      for (const value of ['AM', 'PM']) {
        const option = context.document.createElement('option'); option.value = value; option.textContent = value; period.append(option);
      }
      hour.type = minute.type = 'number';
      hour.min = minute.min = '0'; hour.max = '23'; minute.max = '59';
      hour.setAttribute('aria-label', 'Hours'); minute.setAttribute('aria-label', 'Minutes');
      period.setAttribute('aria-label', 'Day period'); root.append(hour, minute, period);
      return root;
    }, render(context, node, element) {
      const unset = Object.hasOwn(node.properties, 'SelectedTime') && node.properties.SelectedTime == null;
      const value = timeValue(node.properties.SelectedTime ?? node.properties.TimeValue ?? node.properties.Time ?? '12:00',
        node.properties.MinuteIncrement ?? 1);
      const twelveHour = (node.properties.ClockIdentifier ?? '12HourClock') === '12HourClock', hour = Math.floor(value / 3_600_000);
      element.children[0].min = twelveHour ? '1' : '0'; element.children[0].max = twelveHour ? '12' : '23';
      element.children[0].value = unset ? '' : String(twelveHour ? hour % 12 || 12 : hour);
      element.children[1].value = unset ? '' : String(Math.floor(value / 60_000) % 60);
      element.children[0].placeholder = 'Hour';
      element.children[1].placeholder = 'Minute';
      element.children[1].step = String(node.properties.MinuteIncrement ?? 1);
      element.children[2].hidden = !twelveHour; element.children[2].value = hour < 12 ? 'AM' : 'PM';
    }, invoke: pickerInvoke, events: { change(context, node, element) {
      if (node.properties.IsEnabled === false || !element.children[0].value || !element.children[1].value
        || !element.children[0].checkValidity() || !element.children[1].checkValidity()) return false;
      const previous = node.properties.Time;
      const hour = Number(element.children[0].value), twelveHour = (node.properties.ClockIdentifier ?? '12HourClock') === '12HourClock';
      const adjusted = twelveHour ? hour % 12 + (element.children[2].value === 'PM' ? 12 : 0) : hour;
      const value = timeValue(adjusted * 3_600_000 + Number(element.children[1].value) * 60_000,
        node.properties.MinuteIncrement ?? 1);
      const typed = { TotalMilliseconds: value, TotalSeconds: value / 1000 };
      node.properties.Time = String(Math.floor(value / 3_600_000)).padStart(2, '0') + ':' + String(Math.floor(value / 60_000) % 60).padStart(2, '0');
      node.properties.TimeValue = typed; node.properties.SelectedTime = typed;
      if (controlName(node) === 'TimePicker') emitChange(context, node, 'TimeChanged',
        { OldTime: previous, NewTime: node.properties.Time, value: node.properties.Time });
      context.emit(node, 'SelectedTimeChanged', { NewTime: typed });
      return true;
    } }
  });
}

function pickerInvoke(context, node, element, method, args = []) {
  if (method === 'Hide') return hideControlOverlay(context, node);
  if (method !== 'ShowAt' && method !== 'Show') return undefined;
  const target = args[0]?.$ref ? context.host.ensure(args[0].$ref) : null;
  return showControlOverlay(context, node, { target, modal: false });
}

function pickerState(context, node) {
  return stateFor(context, node, 'calendarPicker', () => {
    const events = new ControlEvents();
    const state = { events, entry: null, calendar: null, toggle: null,
      dispose() { if (this.entry) overlayManager(context).dismiss(this.entry); events.dispose(); } };
    events.on('Opened', () => {
      node.properties.IsCalendarOpen = true;
      context.emit(node, 'Opened', { IsCalendarOpen: true });
    });
    events.on('Closed', () => {
      node.properties.IsCalendarOpen = false;
      state.entry = null;
      context.emit(node, 'Closed', { IsCalendarOpen: false });
      context.invalidate(node.id);
    });
    return state;
  });
}

function createCalendarPicker(context, node) {
  const root = context.document.createElement('div');
  const state = pickerState(context, node);
  state.toggle = createPart(context.document, 'button', 'date-picker-toggle');
  state.calendar = createCalendar(context);
  state.calendar.dataset.sfId = node.id;
  state.calendar.setAttribute('role', 'dialog');
  state.calendar.setAttribute('aria-label', 'Choose date');
  state.calendar.style.minWidth = '280px';
  state.calendar.style.background = 'Canvas';
  state.calendar.style.color = 'CanvasText';
  root.append(state.toggle);
  return root;
}

export function formattedPickerDate(value, properties) {
  const format = properties.DateFormat || 'shortdate';
  const styles = { shortdate: 'short', longdate: 'full', 'month day year': 'long' };
  if (!styles[format]) throw new ControlError('SFUI1685', 'Unsupported CalendarDatePicker date format', { format });
  return new Intl.DateTimeFormat(properties.Language ?? 'en-US', { dateStyle: styles[format], timeZone: 'UTC' }).format(dateValue(value));
}

function renderCalendarPicker(context, node) {
  const state = pickerState(context, node);
  const selected = Object.hasOwn(node.properties, 'Date') ? node.properties.Date : node.properties.DateValue;
  state.toggle.textContent = selected ? formattedPickerDate(selected, node.properties) : node.properties.PlaceholderText ?? 'Select date';
  state.toggle.setAttribute('aria-label', String(node.properties.Header ?? 'Date') + ': ' + state.toggle.textContent);
  state.toggle.setAttribute('aria-haspopup', 'dialog');
  state.toggle.setAttribute('aria-expanded', String(!!node.properties.IsCalendarOpen));
  state.toggle.disabled = node.properties.IsEnabled === false;
  renderCalendar(context, node, state.calendar);
  if (node.properties.IsCalendarOpen && !state.entry) {
    state.entry = overlayManager(context).show(state.calendar, { id: node.id + ':calendar', anchor: state.toggle, events: state.events });
  } else if (!node.properties.IsCalendarOpen && state.entry) overlayManager(context).dismiss(state.entry);
}

function calendarPickerEvent(context, node, element, event) {
  if (node.properties.IsEnabled === false) return false;
  const state = pickerState(context, node);
  if (event.target === state.toggle && (event.type === 'click' || event.key === 'ArrowDown' && event.altKey)) {
    event.preventDefault();
    node.properties.IsCalendarOpen = !node.properties.IsCalendarOpen;
    renderCalendarPicker(context, node);
    context.invalidate(node.id);
    return true;
  }
  if (!state.entry) return false;
  if (event.key === 'Escape') {
    overlayManager(context).dismiss(state.entry);
    state.toggle.focus();
    return true;
  }
  const changed = calendarEvent(context, node, state.calendar, event);
  if (changed && event.target.dataset.date && event.type === 'click') {
    overlayManager(context).dismiss(state.entry);
    state.toggle.focus();
  }
  return changed;
}
