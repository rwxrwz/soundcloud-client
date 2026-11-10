// Shared layout constants.
//
// The bottom bar floats over the canvas rather than taking a row beside it, so
// nothing clips its glow and the list keeps running underneath. Everything that
// scrolls has to leave this much room at the end, or the last rows would stay
// stuck behind the glass.
export const BAR_HEIGHT = 80   // the island itself
export const BAR_MARGIN = 12   // its bottom margin (mb-3)
export const BAR_SPACE = BAR_HEIGHT + BAR_MARGIN
