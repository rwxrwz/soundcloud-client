import { useSettings, appDate } from '../store'
import { useT } from '../i18n'

/* The date the seasonal mode reads, and a way to argue with it.
 *
 * Shown in two places - the first-run flow and the System tab - so it lives
 * here rather than being written twice and drifting. Nothing else in the app
 * uses the override: comments and release dates still go by the real clock,
 * because those come from SoundCloud and are not ours to reinterpret. */

const LOCALE: Record<string, string> = { ru: 'ru-RU', uk: 'uk-UA', en: 'en-US' }

export function formatAppDate(lang: string, d = appDate()) {
  return d.toLocaleDateString(LOCALE[lang] ?? 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** `YYYY-MM-DD` for the date input, in local time rather than UTC. */
function asInputValue(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function DateSetting() {
  const t = useT()
  const { lang, dateOverride, setDateOverride } = useSettings()
  const shown = appDate()

  return (
    <div className="date-set">
      <p className="date-now">
        {t('dateNow')} <b>{formatAppDate(lang, shown)}</b>
      </p>
      <p className="date-hint">{t('dateWrong')}</p>
      <div className="date-row">
        <input
          type="date"
          className="date-input"
          value={asInputValue(shown)}
          onChange={e => setDateOverride(e.target.value)}
        />
        {/* Only offered once there is something to undo - an always-present
            reset on a setting nobody has touched is just a dead button. */}
        {dateOverride && (
          <button className="date-reset" onClick={() => setDateOverride('')}>{t('dateReset')}</button>
        )}
      </div>
    </div>
  )
}
