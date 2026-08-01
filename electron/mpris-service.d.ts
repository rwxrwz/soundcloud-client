// Ambient types for `mpris-service` (the package ships no own typings).
// Only the surface we actually use is declared. Linux-only dependency.
declare module 'mpris-service' {
  interface PlayerOptions {
    name: string
    identity?: string
    supportedUriSchemes?: string[]
    supportedMimeTypes?: string[]
    supportedInterfaces?: string[]
  }

  interface PlayerMetadata {
    'mpris:trackid'?: string
    'mpris:length'?: number
    'mpris:artUrl'?: string
    'xesam:title'?: string
    'xesam:artist'?: string[]
    'xesam:album'?: string
    [key: string]: unknown
  }

  interface Player {
    metadata: PlayerMetadata
    playbackStatus: 'Playing' | 'Paused' | 'Stopped'
    volume: number
    canControl: boolean
    canPlay: boolean
    canPause: boolean
    canGoNext: boolean
    canGoPrevious: boolean
    canSeek: boolean
    objectPath(subpath: string): string
    on(event: string, listener: (...args: unknown[]) => void): Player
  }

  function Player(opts: PlayerOptions): Player
  export default Player
}
