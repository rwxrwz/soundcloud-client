import { useUI, useProfile, useToast } from '../store'
import { sc } from '../services/soundcloud'
import { useMenuAnchor } from './menuAnchor'
import { useT } from '../i18n'
import { IcoStroke } from './menuIcons'

export function ArtistContextMenu() {
  const { artistMenu, setArtistMenu, setArtistPage } = useUI()
  const { followingIds, followOptimistic, unfollowOptimistic } = useProfile()
  const { show: showToast } = useToast()
  const t = useT()
  const { data, ref, style } = useMenuAnchor(artistMenu, () => setArtistMenu(null))

  if (!data) return null
  const user = data.user
  const avatar = sc.formatArtwork(user.avatar_url, 't200x200')
  const isFollowing = followingIds.includes(user.id)

  const toggleFollow = () => {
    if (isFollowing) {
      unfollowOptimistic(user.id)
      sc.unfollowUser(user.id).catch(() => { followOptimistic(user.id); showToast(t('followErr'), 'error') })
    } else {
      followOptimistic(user.id)
      sc.followUser(user.id).catch(() => { unfollowOptimistic(user.id); showToast(t('followErr'), 'error') })
    }
  }

  const items = [
    { label: t('ctxOpenArtist'), icon: <IcoStroke><path d="M9 18l6-6-6-6" /></IcoStroke>, onClick: () => setArtistPage(user) },
    {
      label: isFollowing ? t('ctxUnfollow') : t('follow'),
      icon: isFollowing
        ? <IcoStroke><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 11h-6" /></IcoStroke>
        : <IcoStroke><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M20 8v6M23 11h-6" /></IcoStroke>,
      onClick: toggleFollow,
    },
    {
      label: t('ctxCopyLink'),
      icon: <IcoStroke><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></IcoStroke>,
      onClick: () => { if (user.permalink_url) { navigator.clipboard.writeText(user.permalink_url).catch(() => {}); showToast(t('linkCopied'), 'success') } },
    },
    {
      label: t('ctxOpenBrowser'),
      icon: <IcoStroke><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><path d="M15 3h6v6M10 14L21 3" /></IcoStroke>,
      onClick: () => { if (user.permalink_url) window.open(user.permalink_url) },
    },
  ]

  return (
    <div
      ref={ref}
      className="glass-panel fixed z-[200] px-1.5 py-1.5 rounded-xl"
      style={{ ...style, minWidth: 230 }}
      onClick={e => e.stopPropagation()}
    >
      <div className="px-3 pt-2.5 pb-2.5 mb-1 flex gap-2.5 border-b border-white/[0.04] items-center">
        <div className="w-11 h-11 rounded-full overflow-hidden bg-white/5 shrink-0">
          {avatar
            ? <img src={avatar} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center"><svg className="w-5 h-5 text-white/20" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg></div>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white/90 truncate">{user.username}</p>
          <p className="text-[11px] text-white/40 truncate">{(user.followers_count ?? 0).toLocaleString()} {t('followers').toLowerCase()}</p>
        </div>
      </div>

      {items.map((it, i) => (
        <button
          key={i}
          onClick={() => { it.onClick(); setArtistMenu(null) }}
          className="w-full flex items-center gap-2.5 text-left px-2.5 py-1.5 rounded-lg text-sm text-white/75 hover:text-white transition-colors"
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span className="shrink-0 text-white/50">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </div>
  )
}

