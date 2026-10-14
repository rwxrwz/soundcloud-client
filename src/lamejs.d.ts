// lamejs 1.2.1 ships no typings, and its module build is broken: creating an
// encoder throws "MPEGMode is not defined" because index.js never wires those
// internals up. The standard workaround is to put them on globalThis first,
// so the internal modules are declared here too.
declare module 'lamejs' {
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, kbps: number)
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array
    flush(): Int8Array
  }
}

declare module 'lamejs/src/js/MPEGMode.js' {
  const MPEGMode: unknown
  export default MPEGMode
}
declare module 'lamejs/src/js/Lame.js' {
  const Lame: unknown
  export default Lame
}
declare module 'lamejs/src/js/BitStream.js' {
  const BitStream: unknown
  export default BitStream
}
