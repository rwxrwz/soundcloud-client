import 'react'

declare module 'react' {
  interface CSSProperties {
    // Electron frameless-window drag regions
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}
