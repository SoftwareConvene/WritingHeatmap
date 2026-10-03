// When text was written, against the school's hours and an optional due date.
// Uses the browser's own clock and time zone: the teacher's local school day.

export const WHEN = Object.freeze({ SCHOOL: 'school', HOME: 'home', LATE: 'late' });

export const DEFAULT_SCHEDULE = Object.freeze({ days: [1, 2, 3, 4, 5], start: '08:00', end: '15:30' });

function minutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// schedule: { days: [0-6, Sunday = 0], start: 'HH:MM', end: 'HH:MM' } or null.
export function whenFn(schedule, dueAt) {
  const s = schedule && minutes(schedule.start), e = schedule && minutes(schedule.end);
  const days = new Set(schedule && Array.isArray(schedule.days) ? schedule.days : []);
  return (t) => {
    if (t == null) return null;
    if (dueAt && t > dueAt) return WHEN.LATE;
    if (s == null || e == null) return WHEN.HOME;
    const d = new Date(t);
    const m = d.getHours() * 60 + d.getMinutes();
    return days.has(d.getDay()) && m >= s && m < e ? WHEN.SCHOOL : WHEN.HOME;
  };
}

export function emptyWhen() {
  return { school: 0, home: 0, late: 0 };
}
