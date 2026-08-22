const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

function formatter(timeZone = DEFAULT_TIME_ZONE, options = {}) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...options,
  });
}

function parts(date = new Date(), timeZone = DEFAULT_TIME_ZONE, options = {}) {
  return Object.fromEntries(formatter(timeZone, options).formatToParts(date)
    .filter(item => item.type !== 'literal')
    .map(item => [item.type, item.value]));
}

function dateKey(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const value = parts(date, timeZone);
  return `${value.year}-${value.month}-${value.day}`;
}

function timeKey(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const value = parts(date, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${value.hour}:${value.minute}`;
}

function previousDateKey(date = new Date(), days = 1, timeZone = DEFAULT_TIME_ZONE) {
  const shifted = new Date(date.getTime() - Math.max(0, Number(days) || 0) * 86400000);
  return dateKey(shifted, timeZone);
}

module.exports = { DEFAULT_TIME_ZONE, dateKey, timeKey, previousDateKey };
