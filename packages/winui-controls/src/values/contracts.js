export function registerValueContracts(b) {
  const { X, C } = b;
  b.type('System.DateTimeOffset', 'System.ValueType', 'value', [[]]);
  b.props('System.DateTimeOffset', { UnixTimeMilliseconds: ['long', -62135596800000, true], Year: ['int', 1, true],
    Month: ['int', 1, true], Day: ['int', 1, true] });
  b.method('System.DateTimeOffset', 'FromUnixTimeMilliseconds', ['long'], 'System.DateTimeOffset', { isStatic: true });
  b.method('System.DateTimeOffset', 'ToUnixTimeMilliseconds', [], 'long');
  b.enumeration(C + 'CalendarViewSelectionMode', { None: 0, Single: 1, Multiple: 2 });
  b.enumeration(C + 'NumberBoxValidationMode', { InvalidInputOverwritten: 0, Disabled: 1 });
  b.enumeration(C + 'NumberBoxSpinButtonPlacementMode', { Hidden: 0, Compact: 1, Inline: 2 });
  b.control('Primitives.RangeBase', C + 'Control', { Minimum: ['double', 0], Maximum: ['double', 100],
    Value: ['double', 0], SmallChange: ['double', 1], LargeChange: ['double', 10] }, ['ValueChanged']);
  for (const name of ['NumberBox', 'Slider', 'ProgressBar', 'ProgressRing']) b.props(C + name, {
    Minimum: ['double', 0], Maximum: ['double', 100], SmallChange: ['double', 1], LargeChange: ['double', 10] });
  b.props(C + 'NumberBox', { Text: ['string', ''], LargeChange: ['double', 10], IsWrapEnabled: ['bool', false],
    AcceptsExpression: ['bool', false], ValidationMode: [C + 'NumberBoxValidationMode', 0],
    SpinButtonPlacementMode: [C + 'NumberBoxSpinButtonPlacementMode', 0], NumberFormatter: 'object', Description: 'object' });
  b.props(C + 'Slider', { IsDirectionReversed: ['bool', false], TickFrequency: ['double', 0], TickPlacement: ['int', 0],
    SnapsTo: ['int', 0], IsThumbToolTipEnabled: ['bool', true], HeaderTemplate: 'object' });
  b.props(C + 'ProgressBar', { ShowError: ['bool', false], ShowPaused: ['bool', false] });
  for (const name of ['DatePicker', 'CalendarDatePicker', 'DatePickerFlyout', 'CalendarView']) {
    b.control(name, C + 'Control', { Header: 'object', MinYear: 'System.DateTimeOffset', MaxYear: 'System.DateTimeOffset',
      MinDate: 'System.DateTimeOffset', MaxDate: 'System.DateTimeOffset', CalendarIdentifier: ['string', 'GregorianCalendar'],
      DateValue: 'System.DateTimeOffset', SelectedDates: [C + 'ItemCollection', null, true],
      FirstDayOfWeek: ['int', 0], DayOfWeekFormat: ['string', '{dayofweek.abbreviated}'] });
    b.method(C + name, 'SetDate', ['System.DateTimeOffset']); b.method(C + name, 'GetDate', [], 'System.DateTimeOffset');
    b.event(C + name, 'SelectedDateChanged', {
      OldDate: 'System.Nullable`1<System.DateTimeOffset>', NewDate: 'System.Nullable`1<System.DateTimeOffset>'
    });
  }
  b.props(C + 'CalendarView', { SelectionMode: [C + 'CalendarViewSelectionMode', 1], SelectedDates: [C + 'ItemCollection', null, true],
    DisplayMode: ['int', 0], NumberOfWeeksInView: ['int', 6], IsTodayHighlighted: ['bool', true],
    DisplayDate: 'System.DateTimeOffset' });
  b.event(C + 'CalendarView', 'SelectedDatesChanged', { AddedDates: 'object[]', RemovedDates: 'object[]' });
  b.event(C + 'CalendarView', 'CalendarViewDayItemChanging', { Item: 'object', IsBlackout: ['bool', false], Date: 'System.DateTimeOffset' });
  b.method(C + 'CalendarView', 'SetDisplayDate', ['System.DateTimeOffset']);
  b.event(C + 'CalendarDatePicker', 'Opened', { IsCalendarOpen: 'bool' });
  b.event(C + 'CalendarDatePicker', 'Closed', { IsCalendarOpen: 'bool' });
  b.props(C + 'CalendarDatePicker', { IsCalendarOpen: ['bool', false], DateFormat: ['string', ''], Description: 'object' });
  for (const name of ['DatePicker', 'DatePickerFlyout']) b.props(C + name, {
    Date: 'System.DateTimeOffset', SelectedDate: 'System.Nullable`1<System.DateTimeOffset>',
    DayFormat: ['string', '{day.integer}'], MonthFormat: ['string', '{month.full}'],
    YearFormat: ['string', '{year.full}'], DayVisible: ['bool', true], MonthVisible: ['bool', true], YearVisible: ['bool', true] });
  for (const name of ['TimePicker', 'TimePickerFlyout']) {
    b.control(name, C + 'Control', { Header: 'object', MinuteIncrement: ['int', 1], ClockIdentifier: ['string', '12HourClock'],
      SelectedTime: 'System.Nullable`1<System.TimeSpan>', TimeValue: 'System.TimeSpan' });
    b.method(C + name, 'SetTime', ['System.TimeSpan']); b.method(C + name, 'GetTime', [], 'System.TimeSpan');
    b.event(C + name, 'SelectedTimeChanged', {
      OldTime: 'System.Nullable`1<System.TimeSpan>', NewTime: 'System.Nullable`1<System.TimeSpan>'
    });
  }
  for (const name of ['DatePickerFlyout', 'TimePickerFlyout']) {
    b.method(C + name, 'ShowAt', [X + 'FrameworkElement']);
    b.method(C + name, 'Hide');
  }
  b.props(C + 'InfoBar', { IsIconVisible: ['bool', true], IconSource: 'object', ActionButton: 'object', CloseButtonCommand: 'object' });
  b.event(C + 'InfoBar', 'Closing', { Cancel: ['bool', false], Reason: ['int', 0] });
  b.event(C + 'InfoBar', 'CloseButtonClick');
  b.event(C + 'InfoBar', 'Closed', { Reason: ['int', 0] });
  b.control('InfoBadge', C + 'Control', { Value: ['int', -1], IconSource: 'object' });
  b.control('RatingControl', C + 'Control', { Value: ['double', -1], MaxRating: ['int', 5], InitialSetValue: ['int', 1],
    PlaceholderValue: ['double', -1], Caption: ['string', ''], IsClearEnabled: ['bool', true], IsReadOnly: ['bool', false] }, ['ValueChanged']);
  b.control('ColorPicker', C + 'Control', { Color: 'Windows.UI.Color', IsAlphaEnabled: ['bool', false], IsColorSliderVisible: ['bool', true],
    IsColorChannelTextInputVisible: ['bool', true], IsHexInputVisible: ['bool', true], MinHue: ['int', 0], MaxHue: ['int', 359],
    MinSaturation: ['int', 0], MaxSaturation: ['int', 100], MinValue: ['int', 0], MaxValue: ['int', 100] }, ['ColorChanged']);
}
