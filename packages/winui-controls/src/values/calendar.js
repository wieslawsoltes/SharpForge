import { ControlEvents, ControlError } from '../policy/events.js';

const dayMilliseconds = 86_400_000;

export function dateValue(value) {
  const raw = value instanceof Date ? value.getTime() : typeof value === 'number' || typeof value === 'bigint' ? value
    : value?.TotalMilliseconds ?? value?.UnixTimeMilliseconds ?? Date.parse(String(value));
  const result = typeof raw === 'bigint' ? Number(raw) : raw;
  if (!Number.isFinite(result)) throw new ControlError('SFUI1685', 'Invalid calendar date');
  const date = new Date(result);
  date.setUTCHours(0, 0, 0, 0);
  if (!Number.isFinite(date.getTime())) throw new ControlError('SFUI1685', 'Calendar date is outside the supported date range');
  return date.getTime();
}

export function dateText(value) { return new Date(dateValue(value)).toISOString().slice(0, 10); }

export class CalendarModel extends ControlEvents {
  constructor({ displayDate = Date.UTC(2000, 0, 1), minimum = Date.UTC(1900, 0, 1), maximum = Date.UTC(2100, 11, 31),
    firstDayOfWeek = 0, selectionMode = 1, locale = 'en-US', calendar = 'GregorianCalendar' } = {}) {
    super();
    if (!['GregorianCalendar', 'gregory'].includes(calendar)) {
      throw new ControlError('SFUI1686', 'This calendar adapter currently supports Gregorian arithmetic', { calendar });
    }
    this.minimum = dateValue(minimum);
    this.maximum = dateValue(maximum);
    if (this.minimum > this.maximum) throw new ControlError('SFUI1685', 'Calendar date range is reversed');
    this.displayDate = dateValue(displayDate);
    if (!Number.isInteger(firstDayOfWeek) || firstDayOfWeek < 0 || firstDayOfWeek > 6) {
      throw new ControlError('SFUI1685', 'First day of week must be between zero and six');
    }
    this.firstDayOfWeek = firstDayOfWeek;
    this.selectionMode = selectionMode;
    if (![0, 1, 2].includes(selectionMode)) throw new ControlError('SFUI1685', 'Invalid calendar selection mode');
    this.locale = locale;
    this.selectedDates = new Set();
    this.blackoutDates = new Set();
    this.displayMode = 0;
  }

  configure({ minimum = this.minimum, maximum = this.maximum, firstDayOfWeek = this.firstDayOfWeek,
    selectionMode = this.selectionMode, calendar = 'GregorianCalendar', locale = this.locale } = {}) {
    const configured = new CalendarModel({ minimum, maximum, firstDayOfWeek, selectionMode, calendar, locale,
      displayDate: this.displayDate });
    for (const key of ['minimum', 'maximum', 'firstDayOfWeek', 'selectionMode', 'locale']) this[key] = configured[key];
    this.setDisplayDate(this.displayDate);
    for (const date of this.selectedDates) if (date < this.minimum || date > this.maximum || this.selectionMode === 0) {
      this.selectedDates.delete(date);
    }
    if (this.selectionMode === 1 && this.selectedDates.size > 1) this.selectedDates = new Set([this.selectedDates.values().next().value]);
  }

  setDisplayDate(value) { this.displayDate = Math.max(this.minimum, Math.min(this.maximum, dateValue(value))); }
  select(value, { toggle = false } = {}) {
    const date = dateValue(value);
    if (this.selectionMode === 0 || date < this.minimum || date > this.maximum || this.blackoutDates.has(date)) return false;
    const previous = new Set(this.selectedDates);
    if (this.selectionMode === 1) this.selectedDates.clear();
    if (toggle && previous.has(date)) this.selectedDates.delete(date);
    else this.selectedDates.add(date);
    const added = [...this.selectedDates].filter(item => !previous.has(item));
    const removed = [...previous].filter(item => !this.selectedDates.has(item));
    if (added.length || removed.length) this.emit('SelectedDatesChanged', { AddedDates: added, RemovedDates: removed });
    return true;
  }

  days(weeks = 6) {
    if (!Number.isInteger(weeks) || weeks < 2 || weeks > 8) throw new ControlError('SFUI1685', 'Calendar weeks must be between 2 and 8');
    const current = new Date(this.displayDate);
    current.setUTCDate(1);
    const first = current.getTime();
    const weekday = new Date(first).getUTCDay();
    const start = first - ((weekday - this.firstDayOfWeek + 7) % 7) * dayMilliseconds;
    return Array.from({ length: weeks * 7 }, (_, index) => {
      const date = start + index * dayMilliseconds;
      return { date, day: new Date(date).getUTCDate(), inMonth: new Date(date).getUTCMonth() === current.getUTCMonth(),
        isBlackout: this.blackoutDates.has(date) || date < this.minimum || date > this.maximum, selected: this.selectedDates.has(date) };
    });
  }

  moveMonth(delta) {
    const date = new Date(this.displayDate);
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + delta);
    this.setDisplayDate(date.getTime());
    this.emit('DisplayDateChanged', { Date: this.displayDate });
  }
  label() { return new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(this.displayDate); }
  snapshot() { return { version: 1, displayDate: this.displayDate, minimum: this.minimum, maximum: this.maximum,
    selectedDates: [...this.selectedDates], blackoutDates: [...this.blackoutDates], firstDayOfWeek: this.firstDayOfWeek,
    selectionMode: this.selectionMode, displayMode: this.displayMode, locale: this.locale }; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI1685', 'Invalid calendar snapshot');
    for (const name of ['displayDate', 'minimum', 'maximum', 'firstDayOfWeek', 'selectionMode', 'displayMode', 'locale']) this[name] = snapshot[name];
    this.selectedDates = new Set(snapshot.selectedDates);
    this.blackoutDates = new Set(snapshot.blackoutDates);
  }
}

export function timeValue(value, minuteIncrement = 1) {
  if (!Number.isInteger(minuteIncrement) || minuteIncrement < 1 || minuteIncrement > 59) throw new ControlError('SFUI1687', 'Invalid minute increment');
  let milliseconds;
  if (typeof value === 'string') {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
    if (!match || +match[1] > 23 || +match[2] > 59 || +(match[3] ?? 0) > 59) throw new ControlError('SFUI1687', 'Invalid time of day');
    milliseconds = ((+match[1] * 60 + +match[2]) * 60 + +(match[3] ?? 0)) * 1000;
  } else milliseconds = typeof value === 'number' ? value : value?.TotalMilliseconds;
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds >= dayMilliseconds) throw new ControlError('SFUI1687', 'Time must be within one day');
  return Math.floor(milliseconds / (minuteIncrement * 60_000)) * minuteIncrement * 60_000;
}
