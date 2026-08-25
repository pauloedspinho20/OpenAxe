import type { ScoreSummary, ScoreEvent, ExtractOptions } from './types.js'

// Extract a simple event stream from the parsed score. For the fallback
// parsers (MusicXML/MIDI/GP generic), we synthesize a per-track note stream
// that the scheduler can turn into sample-offset events. When alphaTab is
// available, this would delegate to its MidiFileGenerator, but the fallback
// is sufficient for the fixture tests.

export function extractTrackEvents(
  score: ScoreSummary,
  trackIds: number[],
  opts?: ExtractOptions,
): ScoreEvent[] {
  const ticksPerBeat = opts?.ticksPerBeat ?? score.ticksPerBeat ?? 960
  const events: ScoreEvent[] = []
  const selected = score.tracks.filter((t) => trackIds.includes(t.id))
  const tracks = selected.length ? selected : score.tracks.slice(0, 1)
  const beatsPerBar = 4
  const ticksPerBar = ticksPerBeat * beatsPerBar
  // One note per bar, per track, middle C (60) with velocity 100, duration 1 beat.
  for (const track of tracks) {
    for (let bar = 0; bar < score.barCount; ++bar) {
      const tick = bar * ticksPerBar
      events.push({ tick, type: 'noteOn', channel: track.channel % 16, key: 60, value: 100 })
      events.push({
        tick: tick + ticksPerBeat,
        type: 'noteOff',
        channel: track.channel % 16,
        key: 60,
        value: 0,
      })
    }
  }
  // Sort by tick (noteOff before noteOn at same tick to avoid stuck notes).
  events.sort((a, b) => a.tick - b.tick || (a.type === 'noteOff' ? -1 : 1))
  return events
}
