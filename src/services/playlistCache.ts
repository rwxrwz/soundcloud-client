import type { SCTrack } from './soundcloud'

export const playlistCache = new Map<number, SCTrack[]>()
export const hydratingSet = new Set<number>()
