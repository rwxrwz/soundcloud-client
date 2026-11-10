/* The two icon wrappers every context menu draws its glyphs in.
 *
 * They lived four times over, byte for byte, in the four menus that
 * `menuAnchor` was extracted from - so the one thing that pass did not
 * collapse was the smallest. A change to the menu icon weight used to
 * reach one menu in four, which is the kind of drift nobody reports and
 * everybody sees. They are here rather than in `menuAnchor` only because
 * that file is .ts and these are JSX. */

export function Ico({ children }: { children: React.ReactNode }) {
  return <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">{children}</svg>
}

export function IcoStroke({ children }: { children: React.ReactNode }) {
  return <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
}
