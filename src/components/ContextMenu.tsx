import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePlayer, useProfile, useUI, useToast } from '../store'
import { sc } from '../services/soundcloud'
import { findGeniusLink, geniusSearchUrl, type GeniusLink } from '../services/genius'
import { estimateMp3Seconds, transcodeIntoJob } from '../services/mp3Encode'
import { useMenuAnchor } from './menuAnchor'
import { useT } from '../i18n'
import { Ico, IcoStroke } from './menuIcons'

function fmt(n?: number) {
  if (!n) return '0'
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'K'
  return String(n)
}

export function ContextMenu() {
  // Only subscribe to what actually changes the menu. Actions are stable refs, so
  // they come from getState() - subscribing to the whole store (useUI()/usePlayer()
  // /useProfile()/useToast()) re-rendered this on every player-progress tick, which
  // is what made the menu feel janky.
  const contextMenu = useUI(s => s.contextMenu)
  const likes = useProfile(s => s.likes)
  const t = useT()
  const { setContextMenu, setArtistPage, setPlaylistPickerTrack, setShowTrackPage, setShowQueue, setSelectedAlbum } = useUI.getState()
  const { setTrack } = usePlayer.getState()
  const { likeTrackOptimistic, unlikeTrackOptimistic } = useProfile.getState()
  const showToast = useToast.getState().show
  const [genius, setGenius] = useState<GeniusLink | null>(null)
  // Download submenu (portal): coords when open, null when closed.
  const [sub, setSub] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => { setSub(null) }, [contextMenu])
  /* The submenu leaves the way its parent does, but it is the parent's to
     close - its own listeners would fight the ones above, and it must not
     take the parent's place in the one-menu-at-a-time list. */
  const subAnchor = useMenuAnchor(sub, undefined, { child: true })
  /* The submenu counts as inside, and it has to be the element the
     submenu is actually drawn on.
     
     This used to point at a ref of its own that was never attached to
     anything, so it read as null forever and every click in the submenu
     looked like a click outside the parent. The parent's listener runs in
     the capture phase, before React sees the event, and it calls
     stopPropagation on anything outside - so the row under the cursor
     never fired. Nothing happened, nothing failed, and nothing was
     logged, which is a hard shape of bug to chase. */
  const { data, ref, style } = useMenuAnchor(contextMenu, () => setContextMenu(null), { inside: subAnchor.ref })

  // Resolve while the menu is open, so clicking is a direct window.open. Until it
  // lands (or if it fails) the item falls back to a Genius search for the title.
  useEffect(() => {
    const tr = contextMenu?.track
    if (!tr) { setGenius(null); return }
    let cancelled = false
    setGenius(null)
    findGeniusLink(tr.id, tr.title, tr.user?.username ?? '')
      .then(link => { if (!cancelled) setGenius(link) })
      .catch(() => { /* fall back to search */ })
    return () => { cancelled = true }
  }, [contextMenu?.track.id])

  if (!data) return null
  const track = data.track
  const isLiked = likes.some(l => Number(l.id) === Number(track.id))

  // Like/unlike: optimistic with rollback (same pattern as TrackActions).
  const toggleLike = () => {
    if (isLiked) {
      unlikeTrackOptimistic(track.id)
      sc.unlikeTrack(track.id).catch(() => { likeTrackOptimistic(track); showToast(t('errUnlike'), 'error') })
    } else {
      likeTrackOptimistic(track)
      showToast(`${t('toastLiked')}: ${track.title}`, 'success')
      sc.likeTrack(track.id).catch(() => { unlikeTrackOptimistic(track.id); showToast(t('errLike'), 'error') })
    }
  }

  // Download. Two formats:
  //   'original' - whatever SoundCloud serves, saved untouched. That is .m4a for
  //                HLS tracks and .mp3 for the rare plain ones. Fast, lossless.
  //   'mp3'      - a real MP3. HLS sources have to be re-encoded, which takes a
  //                while; plain sources are already MP3 and are just saved.
  // `mode` picks the destination: the downloads folder or a save dialog.
  const download = async (mode: 'folder' | 'dialog', format: 'original' | 'mp3') => {
    const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
    const name = `${clean(track.user?.username ?? 'Unknown')} - ${clean(track.title ?? 'track')}`.slice(0, 180)
    const api = window.electronAPI
    const toast = useToast.getState()
    const ui = useUI.getState()
    // One sticky toast carries the whole job: downloading, converting, done.
    const toastId = toast.show(t('dlStarted'), 'info', true)
    let job: { id: number; dest: string } | null = null
    try {
      const { url, kind } = await sc.getStreamUrl(track)
      // 'original' keeps whatever SoundCloud serves: fMP4 fragments make an .m4a,
      // a plain stream is already .mp3.
      const exts = format === 'mp3' ? ['mp3'] : [kind === 'hls' ? 'm4a' : 'mp3']

      job = (await api?.dlOpen?.(mode, name, exts)) ?? null
      if (!job) { toast.dismiss(toastId); return }   // save dialog cancelled

      // Only an HLS source saved as .mp3 needs the encoder; MP3 into MP3 would
      // just throw away quality for nothing.
      const transcode = kind === 'hls' && job.dest.toLowerCase().endsWith('.mp3')

      if (transcode) {
        const est = estimateMp3Seconds((track.duration ?? 0) / 1000)
        if (est > 60) {
          const human = est >= 60
            ? t('dlMinutes').replace('{n}', String(Math.round(est / 60)))
            : t('dlSeconds').replace('{n}', String(est))
          const msg = t('dlLongWarn')
            .replace('{dur}', sc.formatDuration(track.duration ?? 0))
            .replace('{est}', human)
          if (!await ui.askConfirm(msg, t('dlLongConfirm'))) {
            await api!.dlClose!(job.id, false)
            toast.dismiss(toastId)
            return
          }
        }
        await transcodeIntoJob(job.id, url, f => {
          toast.update(toastId, `${t('dlConverting')} ${Math.round(f * 100)}%`)
        })
      } else {
        await api!.dlFill!(job.id, url, kind)
      }

      await api!.dlClose!(job.id, true)
      toast.dismiss(toastId)
      toast.show(t('dlDone'), 'success')
    } catch (e) {
      if (job) await api?.dlClose?.(job.id, false).catch(() => {})
      toast.dismiss(toastId)
      // Errors raised in main arrive wrapped ("Error invoking remote method ..."),
      // so match loosely - NO_STREAM can come from either side now.
      const msg = (e as Error)?.message ?? ''
      const unavailable = msg === 'DRM' || msg.includes('NO_STREAM')
      showToast(unavailable ? t('dlUnavailable') : t('dlFailed'), 'error')
    }
  }

  /* The cover, saved as a picture.
   *
   * SoundCloud keeps every size of an upload behind the same name, so the
   * one in the queue - `-large`, which is 100 square - is not what anyone
   * wants on disk. `-original` is the file as it was uploaded; it is not
   * always there, so a miss falls back to `-t500x500`, which always is.
   * The job's file is still empty when dlFill throws, so the second attempt
   * writes into it as if the first had never happened. */
  const downloadArt = async (mode: 'folder' | 'dialog') => {
    const raw = track.artwork_url || track.user?.avatar_url
    if (!raw) { showToast(t('dlNoArt'), 'error'); return }
    const clean = (x: string) => x.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
    const name = `${clean(track.user?.username ?? 'Unknown')} - ${clean(track.title ?? 'track')}`.slice(0, 180)
    const ext = (raw.match(/\.(jpe?g|png)(?:\?|$)/i)?.[1] ?? 'jpg').toLowerCase()

    const api = window.electronAPI
    const toast = useToast.getState()
    const toastId = toast.show(t('dlStarted'), 'info', true)
    let job: { id: number; dest: string } | null = null
    try {
      job = (await api?.dlOpen?.(mode, name, [ext])) ?? null
      if (!job) { toast.dismiss(toastId); return }   // save dialog cancelled
      /* Swap whatever size token the url happens to carry, not just
         `-large`: the API gives `-large`, but an avatar fallback or a
         cached entry can arrive already sized. */
      const sized = (size: string) =>
        raw.replace(/-(?:large|original|badge|mini|tiny|small|crop|t\d+x\d+)(\.[a-z]+)/i, `-${size}$1`)
      try {
        await api!.dlFill!(job.id, sized('original'), 'progressive')
      } catch {
        await api!.dlFill!(job.id, sc.formatArtwork(raw, 't500x500'), 'progressive')
      }
      await api!.dlClose!(job.id, true)
      toast.dismiss(toastId)
      toast.show(t('dlDone'), 'success')
    } catch {
      if (job) await api?.dlClose?.(job.id, false).catch(() => {})
      toast.dismiss(toastId)
      showToast(t('dlFailed'), 'error')
    }
  }

  // The Download submenu. Every combination is spelled out: each format once for
  // the downloads folder and once with a location picker. Hiding the destination
  // behind a single "save as" row meant you could pick a format or a place, but
  // never both without guessing.
  const dlArrow = <IcoStroke><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16"/></IcoStroke>
  const dlPlace = <IcoStroke><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></IcoStroke>
  const downloadSub = [
    {
      label: t('ctxDlOriginal'), sub: t('ctxDlOriginalSub'), icon: dlArrow,
      onClick: () => { download('folder', 'original') },
    },
    {
      label: t('ctxDlOriginalAs'), icon: dlPlace,
      onClick: () => { download('dialog', 'original') },
    },
    {
      label: t('ctxDlMp3'), sub: t('ctxDlMp3Sub'),
      icon: <IcoStroke><path d="M4 12a8 8 0 0113.7-5.7M20 12a8 8 0 01-13.7 5.7M17 3v4h-4M7 21v-4h4"/></IcoStroke>,
      onClick: () => { download('folder', 'mp3') },
    },
    {
      label: t('ctxDlMp3As'), icon: dlPlace,
      onClick: () => { download('dialog', 'mp3') },
    },
    {
      label: t('ctxDlArt'), sub: t('ctxDlArtSub'), sep: true,
      icon: <IcoStroke><path d="M3 5h18v14H3z"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="8.5" cy="9" r="1.5"/></IcoStroke>,
      onClick: () => { downloadArt('folder') },
    },
    {
      label: t('ctxDlArtAs'), icon: dlPlace,
      onClick: () => { downloadArt('dialog') },
    },
    {
      label: t('ctxOpenDownloads'), sep: true,
      icon: <IcoStroke><path d="M4 4h6l2 2h8v12H4z"/><path d="M8 13h8"/></IcoStroke>,
      /* Said out loud when it fails. The folder opening is the whole
         point of the row, so a silent no-op is the one outcome it must
         not have. */
      onClick: async () => {
        const err = await window.electronAPI?.openDownloads?.()
        if (err) showToast(`${t('ctxOpenDownloads')}: ${err}`, 'error')
      },
    },
  ]

  // Open the Download submenu next to its row (flips left near the screen edge).
  const openDownloadSub = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const openLeft = r.right + 200 > window.innerWidth
    /* Only the side it opens on is decided here. Fitting it on screen is
       the anchor's job, which measures the thing instead of assuming five
       rows and a separator come to 212px. */
    setSub({ x: openLeft ? Math.max(8, r.left - 196) : r.right - 2, y: r.top - 6 })
  }

  const items = [
    {
      label: t('ctxPlay'),
      icon: <Ico><path d="M8 5v14l11-7z"/></Ico>,
      onClick: () => setTrack(track, usePlayer.getState().queue.length ? usePlayer.getState().queue : [track]),
    },
    {
      label: t('ctxAddNext'),
      icon: <Ico><path d="M3 18h13v-2H3v2zm0-5h10v-2H3v2zm0-7v2h13V6H3zm16 5v-3h-2v3h-3v2h3v3h2v-3h3v-2h-3z"/></Ico>,
      onClick: () => {
        usePlayer.getState().queueNext(track)
      },
    },
    {
      label: t('ctxAddPlaylist'),
      icon: <IcoStroke><path d="M3 6h13M3 12h9M3 18h9M16 15v6M13 18h6"/></IcoStroke>,
      onClick: () => setPlaylistPickerTrack(track),
    },
    {
      label: isLiked ? t('unlike') : t('like'),
      icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 10-7.8 7.8l1 1.1L12 21.2l7.8-7.8 1-1.1a5.5 5.5 0 000-7.7z"/></svg>,
      onClick: () => toggleLike(),
    },
    { divider: true },
    {
      label: t('ctxGoArtist'),
      icon: <IcoStroke><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></IcoStroke>,
      onClick: () => { if (track.user) { setShowTrackPage(false); setShowQueue(false); setSelectedAlbum(null); setArtistPage(track.user) } },
    },
    {
      label: genius?.exact === false ? t('searchGenius') : t('openGenius'),
      icon: <span className="w-3.5 h-3.5 inline-flex items-center justify-center text-[10px] font-extrabold leading-none">G</span>,
      onClick: () => window.open(genius?.url ?? geniusSearchUrl(track.title)),
    },
    {
      label: t('ctxCopyLink'),
      icon: <IcoStroke><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></IcoStroke>,
      onClick: () => {
        if (track.permalink_url) {
          navigator.clipboard.writeText(track.permalink_url).catch(() => {})
          showToast(t('linkCopied'), 'success')
        }
      },
    },
    {
      label: t('ctxOpenBrowser'),
      icon: <IcoStroke><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6M10 14L21 3"/></IcoStroke>,
      onClick: () => { if (track.permalink_url) window.open(track.permalink_url) },
    },
    { divider: true },
    {
      label: t('ctxDownload'),
      icon: <IcoStroke><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16"/></IcoStroke>,
      sub: true,
    },
  ]

  return (
    <>
    <div
      ref={ref}
      className="glass-panel fixed z-[200] px-1.5 py-1.5 rounded-xl"
      style={{ ...style, minWidth: 190, willChange: 'transform' }}
      onClick={e => e.stopPropagation()}
    >
      {/* Track info header */}
      <div className="px-3 pt-2.5 pb-2.5 mb-1 flex gap-2.5 border-b border-white/[0.04]" style={{ minWidth: 248 }}>
        <img
          src={sc.formatArtwork(track.artwork_url || track.user?.avatar_url, 't200x200')}
          alt="" className="w-11 h-11 rounded-lg object-cover bg-white/5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white/90 truncate">{track.title}</p>
          <p className="text-[11px] text-white/40 truncate">{track.user?.username}</p>
          <div className="flex items-center gap-2 mt-1 text-[10px] text-white/45">
            <Stat v={fmt(track.playback_count)} d="M8 5v14l11-7z" fill />
            <Stat v={fmt(track.likes_count)} d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 10-7.8 7.8l1 1.1L12 21.2l7.8-7.8 1-1.1a5.5 5.5 0 000-7.7z" />
            <Stat v={fmt(track.reposts_count)} d="M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3" />
            <Stat v={fmt(track.comment_count)} d="M21 11.5a8.4 8.4 0 01-9 8.4 8.4 8.4 0 01-3.7-.8L3 21l1.9-5.3A8.4 8.4 0 1121 11.5z" />
          </div>
        </div>
      </div>
      {items.map((it, i) =>
        'divider' in it ? (
          <div key={i} className="my-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
        ) : 'sub' in it ? (
          <button
            key={i}
            onClick={e => { e.stopPropagation(); openDownloadSub(e.currentTarget) }}
            className="w-full flex items-center justify-between gap-2.5 text-left px-2.5 py-1.5 rounded-lg text-sm text-white/75 hover:text-white transition-colors"
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span className="flex items-center gap-2.5"><span className="shrink-0 text-white/50">{it.icon}</span>{it.label}</span>
            <svg className="w-3 h-3 text-white/40 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
          </button>
        ) : (
          <button
            key={i}
            onClick={() => { it.onClick!(); setContextMenu(null) }}
            className="w-full flex items-center gap-2.5 text-left px-2.5 py-1.5 rounded-lg text-sm text-white/75 hover:text-white transition-colors"
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span className="shrink-0 text-white/50">{it.icon}</span>
            {it.label}
          </button>
        )
      )}
    </div>
    {subAnchor.data && createPortal(
      <div
        ref={subAnchor.ref}
        className="glass-panel fixed z-[210] py-1.5 rounded-xl"
        style={{ ...subAnchor.style, minWidth: 200, willChange: 'transform' }}
        onClick={e => e.stopPropagation()}
      >
        {downloadSub.map((s, j) => (
          <div key={j}>
          {s.sep && <div className="h-px bg-white/[0.06] mx-2 my-1" />}
          <button
            onClick={() => { s.onClick(); setContextMenu(null) }}
            className="w-full flex items-center gap-2.5 text-left px-2.5 py-1.5 rounded-lg text-sm text-white/75 hover:text-white transition-colors"
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span className="shrink-0 text-white/50">{s.icon}</span>
            {s.sub ? (
              <span className="min-w-0">
                {s.label}
                <span className="block text-[11px] text-white/35 leading-tight">{s.sub}</span>
              </span>
            ) : s.label}
          </button>
          </div>
        ))}
      </div>,
      document.body
    )}
    </>
  )
}

function Stat({ v, d, fill }: { v: string; d: string; fill?: boolean }) {
  return (
    <span className="flex items-center gap-0.5">
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
      {v}
    </span>
  )
}

