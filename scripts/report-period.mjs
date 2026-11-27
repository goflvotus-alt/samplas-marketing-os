export function isReportDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function calendarMonthPeriod(month, offset = 0) {
  const start = new Date(month + '-01T00:00:00Z');
  start.setUTCMonth(start.getUTCMonth() + offset);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { since: start.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) };
}
