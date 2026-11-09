export const raceConfig = {
  carCount: 5, lanes: 3, trackLength: 3200, baseSpeed: 29,
  boostSpeed: 47, boostDuration: 3, slowSpeed: 14, slowDuration: 1.8,
  viewDistance: 430, obstacleSpacing: 145,
  colors: [0xffbd42, 0x9b80ed, 0xff7c8e, 0x4ac6b4, 0x59a9ef],
} as const;
export type RaceStatus = 'ready' | 'running' | 'paused' | 'finished';
export type RaceCommand = { type: 'start' | 'pause' | 'restart' | 'boost' | 'clearBoost' } | { type: 'lane'; direction: -1 | 1 };
export interface CarState { id: string; name: string; color: number; lane: number; distance: number; speed: number; finishTime?: number }
export interface Obstacle { id: number; lane: number; distance: number; hit: boolean }
export interface RaceSnapshot { status: RaceStatus; cars: CarState[]; rank: number; speed: number; distance: number; boost: number; slow: number; elapsed: number }
