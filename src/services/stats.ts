/* Everything the account tab shows, derived from the three things the
 * player actually records: a total, a bucket per day and a bucket per
 * artist. Nothing here keeps state of its own - a second counter is a
 * second thing that can disagree with the first. */

export type Buckets = Record<string, number>

export const DAY = 86_400_000

/* Stepping back by calendar days, not by 86 400 000 milliseconds.
   The two are the same only where the clocks never move: on the day after
   a spring-forward the local day is 23 hours, so `now - DAY` lands on the
   day before last and skips one entirely. Measured under Europe/Kyiv at
   2026-03-30 00:30 local, a fixed-millisecond walk produced 03-30, 03-28,
   03-27 ... - 03-29 missing from "the last seven days", and a run of
   eleven listened days counted as ten. Asking the Date object for the
   previous date leaves that to the calendar, which is whose question it
   is. */
function dayBefore(d: Date): Date {
  const x = new Date(d)
  x.setDate(x.getDate() - 1)
  return x
}

/** Local calendar day as YYYY-MM-DD. Local, not UTC: a listener's day ends
 *  when they go to bed, not at midnight in Greenwich. */
export function dayKey(d: Date | number = new Date()): string {
  const x = typeof d === 'number' ? new Date(d) : d
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

/** Seconds over the last `n` calendar days, today included. */
export function lastDays(byDay: Buckets, n: number, now = Date.now()): number {
  let total = 0
  let d = new Date(now)
  for (let i = 0; i < n; i++) { total += byDay[dayKey(d)] ?? 0; d = dayBefore(d) }
  return total
}

/** The day with the most listening, or null if nothing has been recorded. */
export function bestDay(byDay: Buckets): { day: string; sec: number } | null {
  let best: { day: string; sec: number } | null = null
  for (const [day, sec] of Object.entries(byDay)) {
    if (sec > 0 && (!best || sec > best.sec)) best = { day, sec }
  }
  return best
}

/* Consecutive days ending today, or ending yesterday if today is still
   empty. Without that grace a streak would read as broken every morning
   until the first track, which is a lie about yesterday. */
export function streak(byDay: Buckets, now = Date.now()): number {
  const has = (d: Date) => (byDay[dayKey(d)] ?? 0) > 0
  let start = new Date(now)
  if (!has(start)) {
    start = dayBefore(start)
    if (!has(start)) return 0
  }
  let n = 0
  for (let d = start; has(d); d = dayBefore(d)) n++
  return n
}

/** How many distinct days have any listening at all. */
export const daysListened = (byDay: Buckets): number =>
  Object.values(byDay).filter(v => v > 0).length

/** Artists by time, most first. */
export function topArtists(artists: Buckets, limit = 5): { name: string; sec: number }[] {
  return Object.entries(artists)
    .filter(([name, sec]) => name && sec > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, sec]) => ({ name, sec }))
}

/* Average over the days actually used, not over the calendar. Dividing by
   every day since the first launch answers a question nobody asked - it
   measures how long you have had the app, not how much you listen. */
export const perActiveDay = (listenedSec: number, byDay: Buckets): number => {
  const d = daysListened(byDay)
  return d ? listenedSec / d : 0
}

/** "4 ч 12 мин", "12 мин", "under a minute" - the unit follows the size. */
export function humanTime(sec: number, t: (k: 'stHour' | 'stMin' | 'stLessMin') => string): string {
  if (sec < 60) return t('stLessMin')
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (!h) return `${m} ${t('stMin')}`
  return m ? `${h} ${t('stHour')} ${m} ${t('stMin')}` : `${h} ${t('stHour')}`
}
