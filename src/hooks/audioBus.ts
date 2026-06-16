// Shared handle to the live AnalyserNode created in useAudio, so other views
// (e.g. the home-page wave) can read frequency data without spinning up a
// second audio pipeline.
export const audioBus: { analyser: AnalyserNode | null } = { analyser: null }
