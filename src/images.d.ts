declare module '*.png' {
  const src: string
  export default src
}
declare module '*.jpg' {
  const src: string
  export default src
}
declare module '*.svg' {
  const src: string
  export default src
}
// The sakura branch; webp because it is a photograph with soft gradients and
// a png of it was eight times the size for no visible difference.
declare module '*.webp' {
  const src: string
  export default src
}

// The baked word morph on the welcome screen is shipped as a video asset.
declare module '*.webm' {
  const src: string
  export default src
}
