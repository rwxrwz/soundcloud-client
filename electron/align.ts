/* Putting the real words on the heard timeline.
 *
 * There were two ways to time a song whose lyrics we already have, and the
 * obvious one does not work. Asking the model to time the given lines -
 * here are 28 lines, say when each starts - reads like the easier job, and
 * it is the one it is worst at. Measured on one track: its own
 * transcription of that audio spanned 41-138s of a 148s recording, while
 * its timing of the same song's known words ran 0-91s. Same model, same
 * audio, same minute. It squeezed the song into the first two thirds, so
 * the words were right and arrived early, further ahead the longer you
 * listened.
 *
 * Transcribing anchors it to the audio: it writes a line when it hears one,
 * so the clock comes from the recording. Timing someone else's text does
 * not - nothing forces its answer to stay in step, and it drifts.
 *
 * So the model is asked for the job it does well, and the matching is done
 * here, by WORDS rather than by lines. Lines were the first attempt and
 * they were not enough: the model does not answer in lines. It answers in
 * blocks - one track came back as sixteen stamps, the first of them 36
 * words long, holding four lines of the song under a single time. Matching
 * line to line can pin only one line per block, picks whichever part of the
 * block reads closest, and leaves the other three to be guessed at. Words
 * go inside the block, so every line that was heard gets its own time.
 *
 * It mishears badly - "мы пришли с бедных районов" came back as "мы пришли
 * с звёздных районов" - but a mishearing keeps the shape of what it heard,
 * and enough words survive to say which line is which. The words shown are
 * the ones that went in: this file only ever assigns times. */

export interface Timed { time: number; text: string }

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const split = (s: string) => norm(s).split(' ').filter(Boolean)

const grams = new Map<string, Set<string>>()
function trigrams(w: string): Set<string> {
  let g = grams.get(w)
  if (!g) {
    g = new Set<string>()
    const t = ` ${w} `
    for (let i = 0; i + 3 <= t.length; i++) g.add(t.slice(i, i + 3))
    grams.set(w, g)
  }
  return g
}

/* Dice overlap on character triples rather than on whole words. A misheard
 * word still shares most of its letters with the real one, and comparing
 * them as atoms throws that away: "звёздных" and "бедных" are not equal and
 * are not unrelated either. */
export function similar(a: string, b: string): number {
  const A = trigrams(a)
  const B = trigrams(b)
  if (!A.size || !B.size) return 0
  let shared = 0
  for (const g of A) if (B.has(g)) shared++
  return (2 * shared) / (A.size + B.size)
}

/* Two words count as the same word above this. Higher than the line-level
 * floor used to be, because a word is a much smaller thing to be wrong
 * about: short Russian words share triples easily, and at 0.5 unrelated
 * ones started pairing up. */
const WORD_MIN = 0.62
/* Seconds a line takes when there is nothing at all to measure with. Only
 * reached when the transcript has one stamp and no spread to read a rate
 * from. */
const FALLBACK_PACE = 3

interface Word { t: number; w: string }

/** Every heard word with a time, read off the block it arrived in. A block
 *  carries one stamp for many words, so the words inside it are spread
 *  across the gap to the next stamp - the only even guess available, and a
 *  far smaller one than leaving three lines in four unplaced. */
function spreadWords(heard: Timed[], durationSec: number): Word[] {
  const blocks = heard
    .filter(h => h.time >= 0 && h.time <= durationSec + 5)
    .map(h => ({ t: h.time, words: split(h.text) }))
    .filter(b => b.words.length)
    .sort((a, b) => a.t - b.t)
  if (!blocks.length) return []

  /* The last block has no next stamp to end at, so it ends at the pace the
     rest of the song was delivered at. */
  const first = blocks[0]
  const last = blocks[blocks.length - 1]
  const spokenWords = blocks.slice(0, -1).reduce((n, b) => n + b.words.length, 0)
  const perSec = last.t > first.t && spokenWords ? spokenWords / (last.t - first.t) : 3

  const out: Word[] = []
  blocks.forEach((b, i) => {
    const next = i + 1 < blocks.length
      ? blocks[i + 1].t
      : Math.min(durationSec, b.t + b.words.length / perSec)
    const span = Math.max(next - b.t, 0.1)
    b.words.forEach((w, k) => out.push({ t: b.t + (span * k) / b.words.length, w }))
  })
  return out
}

/** For each WORD of the lyrics, the time of the heard word it was matched
 *  to - or -1. Needleman-Wunsch with free gaps: skipping a word costs
 *  nothing, because plenty of words on both sides have no counterpart at
 *  all. Per word and not per line, because a line is timed by where it
 *  STARTS, and the word that happens to be recognisable in it is as often
 *  its last as its first. Taking the line's first matched word put "на
 *  учёбу по субботам, ты одна, хоть он и с тобой" at the moment of "с
 *  тобой" - a whole line late, and the next line a second behind it. That
 *  is the sticking, then the jump. */
function heardAt(mine: { w: string; line: number }[], words: Word[]): number[] {
  const n = mine.length
  const m = words.length
  const at = new Array<number>(n).fill(-1)
  if (!n || !m) return at

  const score = (i: number, j: number) => {
    const a = mine[i].w
    const b = words[j].w
    if (a === b) return 1
    const s = similar(a, b)
    return s >= WORD_MIN ? s : 0
  }
  const dp: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
  for (let i = 1; i <= n; i++) {
    const row = dp[i]
    const prev = dp[i - 1]
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1] + score(i - 1, j - 1)
      const skip = row[j - 1] > prev[j] ? row[j - 1] : prev[j]
      row[j] = diag > skip ? diag : skip
    }
  }
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const s = score(i - 1, j - 1)
    if (s > 0 && dp[i][j] === dp[i - 1][j - 1] + s) {
      at[i - 1] = words[j - 1].t
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i--
    else j--
  }
  return at
}

/** A time for every word of the lyrics, matched or not: the matched ones
 *  keep theirs, the rest are read off the line drawn between their
 *  neighbours. A word is a steady unit - people deliver roughly so many a
 *  second - so interpolating by word index is a far better guess than
 *  spacing whole lines evenly, and it is what lets a line be timed by its
 *  own first word rather than by whichever of its words was recognised. */
function fillWords(at: number[], durationSec: number, fallbackRate: number): number[] {
  const known: number[] = []
  let last = -1
  at.forEach((t, k) => {
    // Out of order means one of the two is wrong and we cannot tell which;
    // dropping the later one keeps the sequence readable.
    if (t < 0 || t < last) return
    known.push(k)
    last = t
  })
  const out = at.slice()
  if (!known.length) return out.fill(-1)

  const first = known[0]
  const lastK = known[known.length - 1]
  const rate = known.length >= 2 && at[lastK] > at[first]
    ? (lastK - first) / (at[lastK] - at[first])            // words per second
    : fallbackRate
  const step = 1 / Math.max(rate, 0.2)

  for (let p = 0; p + 1 < known.length; p++) {
    const a = known[p]
    const b = known[p + 1]
    for (let k = a + 1; k < b; k++) out[k] = at[a] + ((at[b] - at[a]) * (k - a)) / (b - a)
  }
  for (let k = first - 1; k >= 0; k--) out[k] = Math.max(0, out[k + 1] - step)
  for (let k = lastK + 1; k < out.length; k++) out[k] = Math.min(durationSec, out[k - 1] + step)
  // Words that lost their stamp above sit between their neighbours now.
  for (let k = 0; k < out.length; k++) if (out[k] < 0) out[k] = k > 0 ? out[k - 1] : 0
  return out
}

/** Where each line starts, and how many of them were actually recognised. */
function lineTimes(lyrics: string[], heard: Timed[], durationSec: number): { times: number[]; found: number } {
  const mine: { w: string; line: number }[] = []
  const firstWord = new Array<number>(lyrics.length).fill(-1)
  lyrics.forEach((text, line) => split(text).forEach(w => {
    if (firstWord[line] < 0) firstWord[line] = mine.length
    mine.push({ w, line })
  }))
  const words = spreadWords(heard, durationSec)
  const at = heardAt(mine, words)
  const found = new Set(mine.filter((_, k) => at[k] >= 0).map(x => x.line)).size
  const spoken = words.length
  const heardRate = spoken >= 2 && words[spoken - 1].t > words[0].t
    ? spoken / (words[spoken - 1].t - words[0].t)
    : 1 / FALLBACK_PACE
  const filled = fillWords(at, durationSec, heardRate)

  const times = lyrics.map((_, line) => (firstWord[line] >= 0 ? filled[firstWord[line]] : -1))
  // A line with no words of its own - punctuation, a stray marker - sits
  // where the line before it did rather than at the start of the song.
  for (let i = 0; i < times.length; i++) if (times[i] < 0) times[i] = i > 0 ? times[i - 1] : 0
  return { times, found }
}

/**
 * Times for `lyrics`, read off the timeline of what the model heard.
 * Returns one entry per line, in the order given, with the text untouched.
 * Lines are -1 when there was nothing to time them against.
 */
export function mapOnto(lyrics: string[], heard: Timed[], durationSec: number): Timed[] {
  const out: Timed[] = lyrics.map(text => ({ time: -1, text }))
  if (!lyrics.length) return out

  const { times, found } = lineTimes(lyrics, heard, durationSec)
  /* Nothing of this text was heard in this audio. Say so by leaving the
     times off: the words still go up, they just do not scroll. Inventing a
     timeline here would mean inventing one for the wrong song. */
  if (!found) return out

  // Never backwards, never past the recording, and rounded to something a
  // scroll position can be compared against without noise.
  let prev = 0
  times.forEach((t, i) => {
    const clamped = Math.min(Math.max(t, prev), durationSec)
    out[i].time = Math.round(clamped * 10) / 10
    prev = out[i].time
  })
  return out
}

/** How much of the lyrics was actually recognised in the audio, 0..1 - the
 *  honest measure of how much the times above are worth. */
export function anchorShare(lyrics: string[], heard: Timed[], durationSec: number): number {
  if (!lyrics.length) return 0
  return lineTimes(lyrics, heard, durationSec).found / lyrics.length
}
