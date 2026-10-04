const ticksPerSecond = 10_000_000n;
const secondsPerDay = 86_400n;

/** Constant TimeSpan text from exact signed 100 ns ticks; this is not a public TimeSpan API registration. */
export function formatTimeSpanTicks(ticks) {
  const negative = ticks < 0n;
  const absolute = negative ? -ticks : ticks;
  const totalSeconds = absolute / ticksPerSecond;
  const days = totalSeconds / secondsPerDay;
  const hours = totalSeconds / 3600n % 24n;
  const minutes = totalSeconds / 60n % 60n;
  const seconds = totalSeconds % 60n;
  const fraction = absolute % ticksPerSecond;
  const time = [hours, minutes, seconds].map(value => value.toString().padStart(2, '0')).join(':');
  return (negative ? '-' : '') + (days ? days + '.' : '') + time +
    (fraction ? '.' + fraction.toString().padStart(7, '0') : '');
}
