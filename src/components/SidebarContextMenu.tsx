import { useUI, useSettings } from '../store'
import { NAV } from './Sidebar'
import { useMenuAnchor } from './menuAnchor'
import { useT } from '../i18n'

/* Right-click anywhere on the sidebar rail. By design this menu holds nothing
   but the tab toggles - no play controls, no navigation - so the rail's own
   contents are the only thing it can change. Clicks inside do not close it, so
   several tabs can be toggled in one go. */
export function SidebarContextMenu() {
  const { sidebarMenu, setSidebarMenu } = useUI()
  const { hiddenNav, toggleNavHidden } = useSettings()
  const t = useT()
  const { data, ref, style } = useMenuAnchor(sidebarMenu, () => setSidebarMenu(null))

  if (!data) return null

  return (
    <div
      ref={ref}
      className="glass-panel fixed z-[200] px-1.5 py-1.5 rounded-xl"
      style={{ ...style, minWidth: 220 }}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
    >
      <p className="px-2.5 pt-1.5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
        {t('sidebarTabs')}
      </p>
      {NAV.map(item => {
        const visible = !hiddenNav.includes(item.id)
        // The rail must keep at least one tab, so the last visible one locks.
        const lastOne = visible && hiddenNav.length >= NAV.length - 1
        const Icon = item.icon
        return (
          <button
            key={item.id}
            data-active="false"
            disabled={lastOne}
            onClick={() => toggleNavHidden(item.id)}
            className="row-hover w-full flex items-center gap-2.5 text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors"
            style={{ color: visible ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)', cursor: lastOne ? 'not-allowed' : 'pointer' }}
          >
            <span className="shrink-0" style={{ color: visible ? 'var(--accent)' : 'rgba(255,255,255,0.3)' }}>
              <Icon />
            </span>
            <span className="flex-1">{t(item.key)}</span>
            <MiniToggle on={visible} dim={lastOne} />
          </button>
        )
      })}
    </div>
  )
}

function MiniToggle({ on, dim }: { on: boolean; dim?: boolean }) {
  return (
    <span className="relative rounded-full transition-all duration-200 shrink-0"
      style={{ width: 30, height: 17, background: on ? 'var(--accent)' : 'rgba(255,255,255,0.15)', opacity: dim ? 0.45 : 1 }}>
      <span className="absolute top-1/2 rounded-full bg-white transition-all duration-200"
        style={{ width: 13, height: 13, transform: 'translateY(-50%)', left: on ? 15 : 2 }} />
    </span>
  )
}
