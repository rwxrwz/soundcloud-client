/* The little marks the settings nav wears, in a file of their own so the
   search results can wear the same ones: a result carrying the icon of the
   tab it lives in says where it goes before the breadcrumb is read. */

export function IconUser() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path strokeLinecap="round" d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>
}
export function IconPalette() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-4.4-4.5-8-10-8z"/></svg>
}
export function IconLyrics() {
  /* The same badge the track rows wear when a song has words, so the
     section is recognisable from the thing it configures. The one change:
     it takes its colour from the row instead of a fixed white, so it turns
     accent on the active tab like every other icon here. */
  return (
    <span
      className="inline-flex items-center justify-center text-[10px] font-extrabold leading-none rounded-[4px]"
      style={{ width: 16, height: 16, background: 'color-mix(in srgb, currentColor 20%, transparent)' }}>
      L
    </span>
  )
}
export function IconSound() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M6 9v6M10 5v14M14 8v8M18 11v2"/></svg>
}
export function IconSystem() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>
}
export function IconRemote() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="3"/><path d="M12 6v.01M10 10h4M10 13h4M10 16h4"/></svg>
}
export function IconVersions() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 2v14M12 22v-2M5 7l7-5 7 5v6c0 3-3 5-7 7-4-2-7-4-7-7z"/></svg>
}
export function IconInfo() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".6" fill="currentColor"/></svg>
}
