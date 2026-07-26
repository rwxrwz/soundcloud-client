// Shared handles to the live AnalyserNodes created in useAudio, so other views
// (e.g. the home-page wave) can read frequency data without spinning up a
// second audio pipeline.
//   analyser     - 256-pt, shared by all visualizers (wave, hero, now-playing).
//   bassAnalyser - 2048-pt tap used only by the companion bridge for beat
//                  detection; kept separate so the visualizers stay at 128 bins.
export const audioBus: {
  analyser: AnalyserNode | null
  bassAnalyser: AnalyserNode | null
} = { analyser: null, bassAnalyser: null }
