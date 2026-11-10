// Minimal Telegram Bot API client.
//
// Deliberately dependency-free: the remote control uses eight API methods, and a
// bot framework would pull a dependency tree into a packaged desktop app to give
// us routing and middleware we do not need. Node's global fetch covers the rest.
// If this ever grows into something framework-shaped, everything Telegram-facing
// is behind this file and can be swapped without touching remote.ts.

export interface TgUser {
  id: number
  is_bot: boolean
  first_name: string
  username?: string
}

export interface TgMessage {
  message_id: number
  date: number
  chat: { id: number }
  from?: TgUser
  text?: string
}

export interface TgCallbackQuery {
  id: string
  from: TgUser
  message?: TgMessage
  data?: string
}

export interface TgUpdate {
  update_id: number
  message?: TgMessage
  callback_query?: TgCallbackQuery
}

export class TgError extends Error {
  constructor(public code: number, message: string, public retryAfter?: number) {
    super(message)
    this.name = 'TgError'
  }
}

const API = 'https://api.telegram.org/bot'

interface ApiEnvelope<T> {
  ok?: boolean
  result?: T
  error_code?: number
  description?: string
  parameters?: { retry_after?: number }
}

/** One Bot API call. Throws TgError with the API's own error_code so callers can
 *  tell "bad token" (401) from "another instance is polling" (409) from a
 *  throttle (429), which need three different reactions. */
export async function callApi<T>(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 20000,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const res = await fetch(`${API}${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  })
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null
  if (!body || body.ok !== true) {
    throw new TgError(
      body?.error_code ?? res.status,
      body?.description ?? `HTTP ${res.status}`,
      body?.parameters?.retry_after,
    )
  }
  return body.result as T
}

export type PollStatus = 'online' | 'bad-token' | 'conflict' | 'network'

/** Long polling, not a webhook: the player sits behind NAT and has no public
 *  address, so it asks Telegram rather than being called. An idle getUpdates is
 *  a parked connection - near-zero CPU, no busy loop. */
export class TgPoller {
  private ctrl: AbortController | null = null
  private stopped = true
  private offset = 0

  constructor(
    private token: string,
    private onUpdate: (u: TgUpdate) => Promise<void> | void,
    private onStatus: (s: PollStatus, detail?: string) => void,
  ) {}

  async start(): Promise<void> {
    if (!this.stopped) return
    this.stopped = false
    this.ctrl = new AbortController()
    // Drain whatever piled up while the app was closed WITHOUT acting on it.
    // Otherwise a day of taps replays at once and the player skips fifteen
    // tracks on launch. Callback queries carry no timestamp, so a date filter
    // alone cannot do this - the backlog has to be dropped by offset.
    try {
      const last = await callApi<TgUpdate[]>(this.token, 'getUpdates', { offset: -1, timeout: 0 }, 15000, this.ctrl.signal)
      if (last.length) this.offset = last[last.length - 1].update_id + 1
    } catch { /* first real poll will retry */ }
    void this.loop()
  }

  stop(): void {
    this.stopped = true
    this.ctrl?.abort()
    this.ctrl = null
  }

  private async loop(): Promise<void> {
    let backoff = 1000
    while (!this.stopped) {
      try {
        const updates = await callApi<TgUpdate[]>(
          this.token,
          'getUpdates',
          { offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] },
          35000,
          this.ctrl?.signal,
        )
        if (this.stopped) return
        this.onStatus('online')
        backoff = 1000
        for (const u of updates) {
          this.offset = u.update_id + 1
          try { await this.onUpdate(u) } catch (e) { console.error('[remote] update failed:', e) }
        }
      } catch (err) {
        if (this.stopped) return
        const e = err as TgError
        if (e.code === 401 || e.code === 404) {
          // The token is wrong or the bot was deleted. Retrying cannot fix it.
          this.onStatus('bad-token', e.message)
          this.stopped = true
          return
        }
        if (e.code === 409) {
          // Another process is polling this same bot (a second copy of the app,
          // or a leftover session). Keep trying slowly - it usually clears.
          this.onStatus('conflict', e.message)
        } else if (e.code === 429) {
          this.onStatus('network', e.message)
          backoff = Math.max(backoff, (e.retryAfter ?? 5) * 1000)
        } else {
          this.onStatus('network', e.message)
        }
        await sleep(backoff, this.ctrl?.signal)
        backoff = Math.min(backoff * 2, 30000)
      }
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const id = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(id); resolve() }, { once: true })
  })
}
