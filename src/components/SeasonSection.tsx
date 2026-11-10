import { useState } from 'react'
import { useSettings, seasonActive, type Season, type Snowfall, type GarlandMode } from '../store'
import { useT } from '../i18n'
import { RadioBtn, FsToggleRow, Fold, FoldSwitch } from './settingsControls'

/* Seasonal controls, shaped like the reference's menu rather than like a
   mixing desk: named snowfall steps, a few switches, and one button that
   clears what has piled up. Nobody wants to dial in flakes per megapixel.
   Folded, one group at a time, and each heading says what its group is set to
   while it is shut - flat, this was a column of a dozen controls with no clue
   which switch moved which layer, and it only grows as seasons are added. */
export function SeasonSection() {
  const t = useT()
  const { season, setSeason, snow, setSnow, tree, setTree, garland, setGarland,
          garlandMode, setGarlandMode, seasonPauseBg, setSeasonPauseBg,
          seasonEco, setSeasonEco, meltSnow, rain, sakura } = useSettings()
  const live = seasonActive(season) !== null
  const [fold, setFold] = useState<string | null>(null)

  const fallName = { off: t('fallOff'), light: t('fallLight'), steady: t('fallSteady'), heavy: t('fallHeavy') }[snow.fall]
  const glName = !garland ? t('seasonShortOff')
    : garlandMode === 'twinkle' ? t('glTwinkle')
    : garlandMode === 'run' ? t('glRun') : t('glStatic')
  const note = (text: string) => <span className="edit-fold-note">{text}</span>

  /* A grid, not a wrapping row: four chips in a 268px column broke three and
     one, which reads as a mistake rather than as a choice of four. */
  const chips = <T extends string>(items: [T, string][], value: T, pick: (v: T) => void) => (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${items.length === 4 ? 2 : items.length}, minmax(0, 1fr))` }}>
      {items.map(([v, l]) => (
        <button key={v} onClick={() => pick(v)}
          className="icon-btn px-1 py-1.5 rounded-lg text-[10.5px] truncate transition-all"
          style={{
            background: value === v ? 'rgba(var(--accent-rgb),0.2)' : 'rgba(255,255,255,0.06)',
            border: value === v ? '1px solid rgba(var(--accent-rgb),0.45)' : '1px solid rgba(255,255,255,0.08)',
            color: value === v ? '#fff' : 'rgba(255,255,255,0.6)',
          }}>{l}</button>
      ))}
    </div>
  )
  return (
    <>
      <div className="space-y-1">
        {([['auto', t('seasonAuto'), t('seasonAutoSub')],
           ['newyear', t('seasonOn'), ''],
           ['off', t('seasonOff'), '']] as [Season, string, string][])
          .map(([v, l, sub]) => (
            <RadioBtn key={v} active={season === v} onClick={() => setSeason(v)} label={l} sub={sub || undefined} />
          ))}
        {/* One sky at a time - said before it happens, not discovered after
            the rain has gone. The night sky is not named here because snow
            is welcome to fall through it. */}
        {!live && (rain || sakura) && (
          <p className="text-[10px] text-white/35 leading-tight pt-0.5 px-1">
            {rain ? t('seasonOffRain') : t('seasonOffSakura')}
          </p>
        )}
      </div>

      {live && (
        <div className="page-enter mt-2">
          <Fold sub id="snow" label={t('snowGroup')} open={fold} setOpen={setFold} preview={note(fallName)}>
            <div className="space-y-2.5">
              <div>
                <p className="text-[11px] text-white/45 mb-1.5">{t('snowTitle')}</p>
                {chips(([['off', t('fallOff')], ['light', t('fallLight')],
                         ['steady', t('fallSteady')], ['heavy', t('fallHeavy')]] as [Snowfall, string][]),
                       snow.fall, v => setSnow({ fall: v }))}
              </div>
              <FsToggleRow label={t('snowOnPanels')} active={snow.onPanels} onClick={() => setSnow({ onPanels: !snow.onPanels })} />
              <FsToggleRow label={t('snowPhysics')} active={snow.physics} onClick={() => setSnow({ physics: !snow.physics })} />
              <button onClick={meltSnow}
                className="icon-btn w-full py-2 rounded-lg text-[12px] text-white/70 hover:text-white transition-all"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {t('snowMeltNow')}
              </button>
            </div>
          </Fold>

          {/* The tree is one switch. It sits at the level of the headings around
              it instead of behind one of them. */}
          <FoldSwitch label={t('seasonTree')} active={tree} onClick={() => setTree(!tree)} />

          <Fold sub id="garland" label={t('seasonGarland')} open={fold} setOpen={setFold} preview={note(glName)}>
            <div className="space-y-2.5">
              <FsToggleRow label={t('onLabel')} active={garland} onClick={() => setGarland(!garland)} />
              {garland && (
                <div className="page-enter">
                  <p className="text-[11px] text-white/45 mb-1.5">{t('garlandMode')}</p>
                  {chips(([['twinkle', t('glTwinkle')], ['run', t('glRun')],
                           ['static', t('glStatic')]] as [GarlandMode, string][]),
                         garlandMode, v => setGarlandMode(v))}
                </div>
              )}
            </div>
          </Fold>

        </div>
      )}

      {/* Outside the winter block on purpose: these two throttle every drawn
          layer there is - the branch and the night sky included - and tucked
          inside the seasonal controls they were unreachable for eight months
          of the year while still governing what was on screen. */}
      <div className="mt-2">
        <Fold sub id="perf" label={t('perfGroup')} open={fold} setOpen={setFold}
          preview={seasonEco ? note(t('ecoShort')) : undefined}>
          <div className="space-y-2.5">
            <div>
              <FsToggleRow label={t('seasonEco')} active={seasonEco} onClick={() => setSeasonEco(!seasonEco)} />
              <p className="text-[10px] text-white/30 mt-0.5 leading-tight">{t('seasonEcoSub')}</p>
            </div>
            <div>
              <FsToggleRow label={t('seasonPauseBg')} active={seasonPauseBg} onClick={() => setSeasonPauseBg(!seasonPauseBg)} />
              <p className="text-[10px] text-white/30 mt-0.5 leading-tight">{t('seasonPauseBgSub')}</p>
            </div>
          </div>
        </Fold>
      </div>

      {/* The next season, held open as a slot. Everything above it is New Year
          - snow, a tree, a garland - and when Halloween gets its own layers
          they hang off this heading and off seasonActive() in the store. */}
      <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <Fold sub soon id="halloween" label={t('seasonHalloween')} open={fold} setOpen={setFold}
          preview={<span className="edit-fold-soon">soon</span>} />
      </div>
    </>
  )
}
