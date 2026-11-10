/* What changed since the last time this person opened the player.
 *
 * Written as a list rather than a screen, so shipping the next release is
 * one entry here and nothing else. The card that draws it knows how to
 * draw an entry; it does not know what is in any particular one.
 *
 * Who sees it, and who does not, is the whole design:
 *
 *   - a fresh install sees the first-run flow and nothing else. Finishing
 *     it stamps the current version, so the news it would otherwise be
 *     shown is news about a player it has never been without.
 *   - somebody updating sees the news and not the first run. They are told
 *     apart by their stored settings: anything written before 2.0 has no
 *     record of the first run at all, which settingsPredateFirstRun reads
 *     as "has been here before". Their stamp is missing too, so they get
 *     everything, newest first.
 *   - somebody opening the same build again has a stamp equal to it and
 *     sees nothing.
 *
 * Entries past the running version are ignored rather than shown early,
 * so a line can be written for the next release before it is out.
 */

import { cmpVersion } from './updates'
import type { TKey } from '../i18n'

export interface NewsItem {
  /** The release this arrived in. */
  version: string
  /** One or two words, for the strip of names across the top. */
  name: TKey
  /** The one line under it saying what the thing is. */
  body: TKey
  /** A drawing above the text, when a picture says it faster. */
  art?: 'editmode'
  /** A real control on the slide, so the thing can be switched on here
   *  rather than hunted down in settings afterwards. */
  control?: 'lyrics' | 'switches' | 'themes' | 'remote'
  /** Takes the window over and gives it back. Only editing mode needs
   *  this; everything else changes the player behind the glass, which is
   *  see-through, so there is nothing to leave. */
  preview?: 'editmode'
}

/* Newest first. The version on an entry is the one it shipped in, not the
   one being built: that is what decides who has already seen it. */
export const NEWS: NewsItem[] = [
  { version: '2.0.0', name: 'nwEditName', body: 'nwEditBody', art: 'editmode', preview: 'editmode' },
  { version: '2.0.0', name: 'nwLyricsName', body: 'nwLyricsBody', control: 'lyrics' },
  /* Two switches on one slide. Neither has enough to say for a slide of
     its own, and both answer the same kind of question - whether the
     player should do a thing on its own or stay out of it. */
  { version: '2.0.0', name: 'nwSwitchName', body: 'nwSwitchBody', control: 'switches' },
  { version: '2.0.0', name: 'nwThemesName', body: 'nwThemesBody', control: 'themes' },
  /* Named after the settings tab it is, rather than after the device at
     the other end: "your phone" described the symptom. Carries the real
     section, like the slides above it, so the bot can be set up here. */
  { version: '2.0.0', name: 'catRemote', body: 'nwRemoteBody', control: 'remote' },
]

/** What this person is owed, or null when that is nothing.
 *
 *  The one place that decides it, so the launch check and the preview
 *  button in settings cannot drift apart. Pass '' for `lastSeen` to ask
 *  what somebody arriving from an older build would be shown. */
export async function pendingNews(lastSeen: string): Promise<{ items: NewsItem[]; version: string } | null> {
  let version = ''
  try { version = (await window.electronAPI?.getAppVersion?.()) ?? '' } catch { /* no bridge */ }
  if (!version) return null
  const items = unseenNews(lastSeen, version)
  return items.length ? { items, version } : { items: [], version }
}

/** Everything released after `lastSeen` and no later than `current`.
 *
 *  An empty `lastSeen` means somebody who has been running the player
 *  without this ever being recorded - every build before this one. They
 *  are shown what the list holds, which is what they in fact missed. */
export function unseenNews(lastSeen: string, current: string): NewsItem[] {
  return NEWS.filter(n =>
    cmpVersion(n.version, current) <= 0 &&
    (!lastSeen || cmpVersion(n.version, lastSeen) > 0))
}

/** Were these stored settings written by a build with no first run?
 *
 *  `seenWelcome` arrived with the first-run flow in 2.0, so everything
 *  1.3.x wrote is missing it - and a missing key falls back to its default,
 *  which says "has not seen it". That made every upgrade look like a fresh
 *  install. Settings that exist at all mean the player has been run before;
 *  settings that exist without this key mean they were written by a build
 *  that had no first run to skip.
 *
 *  Takes the raw string rather than reading storage itself, so the decision
 *  can be tested against real payloads instead of trusted.
 */
export function settingsPredateFirstRun(raw: string | null): boolean {
  if (!raw) return false
  try {
    const had = (JSON.parse(raw) as { state?: Record<string, unknown> } | null)?.state
    return !!had && typeof had === 'object' && had.seenWelcome === undefined
  } catch {
    // Unreadable settings are not evidence of anything. Treat as fresh.
    return false
  }
}
