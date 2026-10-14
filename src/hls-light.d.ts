// hls.js ships type declarations only for its full build. We import the `light`
// entry point instead (no DRM/subtitles/alt-audio/CMCD, ~70 KB smaller gzipped),
// and its API is a subset of the full one — so reuse the full build's types.
declare module 'hls.js/light' {
  export * from 'hls.js'
  export { default } from 'hls.js'
}
