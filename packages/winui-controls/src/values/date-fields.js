import { dateValue } from './calendar.js';
import { ControlError, createPart } from '../policy/events.js';

/** Uses the platform's locale data for field order while keeping date arithmetic Gregorian and UTC. */
export function dateFieldOrder(locale = 'en-US') {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' })
    .formatToParts(Date.UTC(2000, 10, 22)).filter(part => ['day', 'month', 'year'].includes(part.type)).map(part => part.type);
}

export function dateFromFields({ year, month, day }, { minimum, maximum } = {}) {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12
    || !Number.isInteger(day) || day < 1 || day > 31) throw new ControlError('SFUI1685', 'Invalid date field value');
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, 1);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCMonth(month, 0);
  date.setUTCDate(Math.min(day, date.getUTCDate()));
  const value = date.getTime();
  return Math.max(minimum ?? value, Math.min(maximum ?? value, value));
}

function formatField(locale, field, value, properties) {
  const name = field[0].toUpperCase() + field.slice(1) + 'Format';
  const format = properties[name] ?? (field === 'month' ? '{month.full}' : `{${field}.integer}`);
  const styles = { '{month.full}': 'long', '{month.abbreviated}': 'short', '{month.integer}': 'numeric',
    '{month.integer(2)}': '2-digit', '{day.integer}': 'numeric', '{day.integer(2)}': '2-digit',
    '{year.full}': 'numeric', '{year.integer}': 'numeric', '{year.abbreviated}': '2-digit' };
  if (!Object.hasOwn(styles, format)) throw new ControlError('SFUI1685', 'Unsupported date-field format', { field, format });
  const date = new Date(Date.UTC(2000, 0, 1));
  if (field === 'year') date.setUTCFullYear(value);
  else if (field === 'month') date.setUTCMonth(value - 1);
  else date.setUTCDate(value);
  return new Intl.DateTimeFormat(locale, { [field]: styles[format], timeZone: 'UTC' }).format(date);
}

export function renderDateFields(context, node, container, model) {
  const properties = node.properties;
  const locale = properties.Language ?? model.locale;
  const value = Object.hasOwn(properties, 'SelectedDate') ? properties.SelectedDate : properties.DateValue ?? properties.Date;
  const date = value == null ? null : new Date(dateValue(value));
  const order = dateFieldOrder(locale).filter(field => properties[field[0].toUpperCase() + field.slice(1) + 'Visible'] !== false);
  const children = [];
  for (const field of order) {
    const select = container.querySelector(`[data-date-field="${field}"]`) ?? createPart(context.document, 'select', 'date-field');
    select.dataset.dateField = field;
    select.setAttribute('aria-label', field[0].toUpperCase() + field.slice(1));
    const selected = date ? field === 'year' ? date.getUTCFullYear() : field === 'month' ? date.getUTCMonth() + 1 : date.getUTCDate() : null;
    const first = field === 'year' ? Math.max(1, new Date(model.minimum).getUTCFullYear()) : 1;
    const last = field === 'year' ? Math.min(9999, new Date(model.maximum).getUTCFullYear()) : field === 'month' ? 12 : 31;
    const formatProperty = field[0].toUpperCase() + field.slice(1) + 'Format';
    const key = `${locale}:${field}:${first}:${last}:${properties[formatProperty]}`;
    if (select.dataset.optionsKey !== key) {
      const options = [];
      const placeholder = context.document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = field[0].toUpperCase() + field.slice(1);
      options.push(placeholder);
      for (let number = first; number <= last; number++) {
        const option = context.document.createElement('option');
        option.value = String(number);
        option.textContent = formatField(locale, field, number, properties);
        options.push(option);
      }
      select.replaceChildren(...options);
      select.dataset.optionsKey = key;
    }
    select.value = selected == null ? '' : String(selected);
    select.disabled = properties.IsEnabled === false;
    children.push(select);
  }
  context.ordered(container, children);
}

export function selectedDateFields(container, model) {
  const date = new Date(model.displayDate);
  const values = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  for (const select of container.querySelectorAll('[data-date-field]')) {
    if (!select.value) return null;
    values[select.dataset.dateField] = Number(select.value);
  }
  return dateFromFields(values, model);
}
