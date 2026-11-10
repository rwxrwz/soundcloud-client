import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { useEscape } from '../hooks/useEscape'

/* Everything a context menu does apart from its own contents.
 *
 * Every menu in the player used to carry its own copy of this, and every
 * copy carried the same faults, which is what a copy is for.
 *
 * Placing. A menu is rendered with `scale-in`, whose first frame is
 * scale(0.9), and each copy measured itself with getBoundingClientRect() in
 * that same frame. A rect is the TRANSFORMED box, so a 432px menu reported
 * 389px and the "keep it on screen" clamp happily placed it 43px past the
 * bottom of the window, where it was cut off. offsetHeight is a layout
 * number and ignores transforms, so it is the one to ask. Most of the
 * copies also positioned themselves in a useEffect, which runs after the
 * paint: the menu appeared wherever the previous one had been and jumped.
 *
 * Closing. A left-click outside closes the menu and is swallowed, so the
 * click that dismissed it does not also start playing whatever was under
 * it. A right-click while a menu is open only dismisses it: it used to
 * fall through to the element beneath, so one press closed a menu here and
 * opened another one over there.
 *
 * One at a time. Two menus on screen at once are two answers to one press,
 * so opening any menu closes the rest.
 *
 * It also holds the payload past the moment the store drops it, so a menu
 * can animate out instead of blinking off. */

export type MenuAt = { x: number; y: number }

/* Matches the ctx-out keyframes in index.css. */
const OUT_MS = 110
/* The gap left between a menu and the edge of the window. */
const EDGE = 8
/* And between a menu and the cursor. Opened exactly on the pointer, the
   first row sits under the cursor and reads as already chosen. */
const CURSOR_GAP = 8

/* The menus currently on screen, so a new one can dismiss them. Submenus
   are not in here: they belong to the menu that opened them. */
const openMenus = new Set<() => void>()

export function useMenuAnchor<T extends MenuAt>(
  at: T | null,
  close?: () => void,
  opts: { inside?: RefObject<HTMLElement | null>; child?: boolean } = {},
) {
  const ref = useRef<HTMLDivElement>(null)
  const [held, setHeld] = useState<T | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [place, setPlace] = useState({ x: 0, y: 0, origin: 'left top' })

  /* Derived, not stored, so the menu is in the DOM in the very render that
     `at` arrives - a state hop here would cost a frame, and the layout
     effect below would find no element to measure. */
  const data = at ?? held

  // Kept in a ref so the listeners below never need re-binding.
  const closeRef = useRef(close)
  closeRef.current = close
  const insideRef = opts.inside
  const child = !!opts.child
  const self = useRef(() => closeRef.current?.()).current

  useEffect(() => {
    if (at) { setHeld(at); setLeaving(false); return }
    if (!held) return
    setLeaving(true)
    const id = setTimeout(() => { setHeld(null); setLeaving(false) }, OUT_MS)
    return () => clearTimeout(id)
  }, [at, held])

  useEffect(() => {
    if (!at || child || !closeRef.current) return
    for (const other of openMenus) if (other !== self) other()
    openMenus.add(self)
    return () => { openMenus.delete(self) }
  }, [at, child, self])

  useLayoutEffect(() => {
    if (!at) return
    const el = ref.current
    // Layout metrics, not a rect: see the note at the top of this file.
    const w = el?.offsetWidth ?? 0
    const h = el?.offsetHeight ?? 0
    const wantX = at.x + CURSOR_GAP
    const flipX = wantX + w > window.innerWidth
    const flipY = at.y + h > window.innerHeight
    setPlace({
      // Flipped, the gap goes the other way: still clear of the cursor.
      x: Math.max(EDGE, flipX ? Math.min(at.x - CURSOR_GAP - w, window.innerWidth - w - EDGE) : wantX),
      y: Math.max(EDGE, flipY ? window.innerHeight - h - EDGE : at.y),
      /* Grow out of the corner nearest the cursor. Pinned to top-left, a
         menu pushed back from the bottom edge looked like it flew up from
         somewhere below the pointer. */
      origin: `${flipX ? 'right' : 'left'} ${flipY ? 'bottom' : 'top'}`,
    })
  }, [at])

  /* Escape goes through the shared stack rather than a listener of this
     hook's own. Window listeners are siblings, so a raw one here fired on
     the same press as the page underneath and both closed: right-click a
     row on an artist page, press Escape, and the artist page went with the
     menu. A menu mounted over that page is simply the top of the stack.
     Only while it is open and is not a submenu - a submenu's parent is the
     one that owns the key. */
  useEscape(self, !!at && !child)

  useEffect(() => {
    if (!at || child || !closeRef.current) return
    const within = (t: Node) => !!ref.current?.contains(t) || !!insideRef?.current?.contains(t)
    /* Capture, so this runs before the handler on whatever was clicked.
       Inside the menu the event passes through untouched and the items
       still work. */
    const onClick = (e: MouseEvent) => {
      if (within(e.target as Node)) return
      e.preventDefault(); e.stopPropagation()
      self()
    }
    const onCtx = (e: MouseEvent) => {
      e.preventDefault()
      if (within(e.target as Node)) return
      e.stopPropagation()
      self()
    }
    // Next frame, or the very press that opened the menu would close it.
    const id = requestAnimationFrame(() => {
      window.addEventListener('click', onClick, true)
      window.addEventListener('contextmenu', onCtx, true)
      window.addEventListener('resize', self)
    })
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('contextmenu', onCtx, true)
      window.removeEventListener('resize', self)
    }
  }, [at, child, self, insideRef])

  const style: CSSProperties = {
    top: place.y,
    left: place.x,
    transformOrigin: place.origin,
    /* A menu taller than the window scrolls rather than running off it.
       The clamp above then has a real height to work with. */
    maxHeight: `calc(100vh - ${EDGE * 2}px)`,
    overflowY: 'auto',
    overflowX: 'hidden',
    animation: leaving ? `ctx-out ${OUT_MS}ms ease forwards` : 'scale-in 0.12s ease',
    // On the way out it is a picture of a menu; clicks belong to what is under it.
    pointerEvents: leaving ? 'none' : undefined,
  }

  return { data, ref, style, leaving } as {
    data: T | null
    ref: RefObject<HTMLDivElement>
    style: CSSProperties
    leaving: boolean
  }
}
