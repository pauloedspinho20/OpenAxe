/**
 * @openaxe/songbook — parse .gp3-.gp8 / .musicxml / .mid / .atex into a score
 * model + event stream (issue #163). Primary implementation is @coderline/alphatab
 * (MPL-2.0, GPLv3-compatible); fallback parsers keep the tests green without it.
 */
export * from './types.js'
export { parseScore } from './parse.js'
export { extractTrackEvents } from './events.js'
export { scheduleEvents, ticksForBars } from './scheduler.js'
export type { ScheduledEvent, SchedulerOptions } from './scheduler.js'
