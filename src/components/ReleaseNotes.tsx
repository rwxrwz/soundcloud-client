/* The release body from GitHub, drawn rather than printed.
 *
 * The Versions tab used to put the raw text in a <p> with pre-wrap, so a
 * note written the way these notes are written - "### 🆕 Новое", then
 * "- **Страница пользователя** - ..." - arrived on screen with its hashes
 * and asterisks intact, which is the markup showing through the thing it
 * was meant to shape.
 *
 * Only the subset these notes actually use is understood: headings,
 * bullets, bold, inline code, links and blank lines. Anything else is left
 * as the plain text it is, which is the right failure for a renderer whose
 * input is written by hand in a textarea on github.com. No markdown
 * library - that is tens of kilobytes in the one chunk the renderer ships
 * as - and no dangerouslySetInnerHTML, because this string comes off the
 * network.
 */

import type { ReactNode } from 'react'

/** `**bold**`, `` `code` `` and `[text](url)`, in one pass, left to right. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g
  let at = 0
  let m: RegExpExecArray | null
  let n = 0
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index))
    const k = `${keyBase}-${n++}`
    if (m[1] !== undefined) {
      out.push(<strong key={k} className="font-semibold text-white/85">{m[1]}</strong>)
    } else if (m[2] !== undefined) {
      out.push(
        <code key={k} className="px-1 py-0.5 rounded text-[12px]"
          style={{ background: 'rgba(255,255,255,0.07)' }}>{m[2]}</code>,
      )
    } else {
      /* Only http(s) is followed. A note is written by a person on GitHub,
         but it still arrives over the network, and `javascript:` in an
         href is the oldest way to turn text into an action. */
      const href = m[4]
      const safe = /^https?:\/\//i.test(href)
      out.push(safe
        ? <button key={k} onClick={() => window.open(href)}
            className="underline underline-offset-2 hover:text-white/80 transition-colors"
            style={{ color: 'var(--accent)' }}>{m[3]}</button>
        : <span key={k}>{m[3]}</span>)
    }
    at = m.index + m[0].length
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}

export function ReleaseNotes({ body }: { body: string }) {
  const lines = body.trim().split('\n')
  const out: ReactNode[] = []
  /* Bullets are gathered so a run of them becomes one list. Drawing each
     one as its own element put the gap between list items wherever the
     author happened to press enter. */
  let bullets: string[] = []

  const flush = (at: number) => {
    if (!bullets.length) return
    const items = bullets
    bullets = []
    out.push(
      <ul key={`ul-${at}`} className="space-y-1 my-1.5">
        {items.map((b, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-white/25 select-none shrink-0">·</span>
            <span className="min-w-0">{inline(b, `b-${at}-${i}`)}</span>
          </li>
        ))}
      </ul>,
    )
  }

  lines.forEach((raw, i) => {
    const line = raw.trimEnd()
    const head = /^(#{1,6})\s+(.*)$/.exec(line)
    if (head) {
      flush(i)
      /* Every level is drawn the same. A release note is a flat list of
         topics with a few sub-topics, not a document with an outline, and
         six sizes of heading in a 300px panel reads as noise. The level
         only decides the spacing above. */
      const deep = head[1].length >= 3
      out.push(
        <p key={i}
          className={`text-[12px] font-semibold uppercase tracking-wider text-white/45 ${out.length ? (deep ? 'mt-3' : 'mt-4') : ''} mb-1`}>
          {inline(head[2], `h-${i}`)}
        </p>,
      )
      return
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) { bullets.push(bullet[1]); return }
    if (!line.trim()) { flush(i); return }
    flush(i)
    out.push(<p key={i} className="leading-relaxed">{inline(line, `p-${i}`)}</p>)
  })
  flush(lines.length)

  return <div className="text-[13px] text-white/55 mt-2 space-y-1">{out}</div>
}
