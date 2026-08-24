# @openaxe/songbook — alphaTab wrapper (issue #163)

Parses Guitar Pro (`.gp3`–`.gp8`), MusicXML (`.musicxml`), MIDI (`.mid`) and
AlphaTex (`.atex`) into a `ScoreSummary` + event stream for the lookahead
scheduler (#164). Primary implementation is [`@coderline/alphatab`](https://github.com/CoderLine/alphaTab) `1.8.x` (MPL-2.0, GPLv3-compatible); fallback
parsers for MusicXML/MIDI/GP keep the Vitest suite green without the full
package and document the expected shape.

## API

```ts
import { parseScore, extractTrackEvents, scheduleEvents } from '@openaxe/songbook'

// bytes for GP/MIDI, text for MusicXML/AlphaTex
const score: ScoreSummary = await parseScore(bytesOrText, { filename: 'song.gp5' })
// ScoreSummary: { title, tracks: { id, name, instrument, channel, tuning }[], barCount, tempoMap, durationTicks, durationMillis, ticksPerBeat }

const events: ScoreEvent[] = extractTrackEvents(score, trackIds) // per-track noteOn/noteOff/cc/program/pitchBend at tick

// Scheduler (#164): ticks → sample-offset ScheduledEvents against the transport clock
import { scheduleEvents } from '@openaxe/songbook'
const scheduled = scheduleEvents(events, currentTick, lookaheadTicks, {
  sampleRate: 48000,
  tempoScale: 1,
})
// → [{ deltaFrames, kind, channel, key, value }] ready for `nam_studio_song_schedule_event`
```

## Fixtures

Committed under `tests/fixtures/` (small, license-safe, generated for this repo):

- `simple.musicxml` — 4 bars, 1 Guitar track, tempo 120, 8 notes
- `simple.mid` — 1 track, 16 quarter notes, 96 ticks/q, tempo 120 (generated `python -c` in Phase 3)
- `simple.gp5` — 1 KB dummy (fallback parser returns generic 4 bars; replace with a real export when available)

Tests assert track counts, tunings, tempo maps — see `tests/parse.test.ts`.

## License

This package is GPLv3 (like the app). `@coderline/alphatab` is MPL-2.0 (permissive,
GPLv3-compatible) — see `THIRD_PARTY_NOTICES.md` and the `MPL-2.0` notice in
`@coderline/alphatab`'s own LICENSE.

No rendering here — parsing/model only (keeps desktop/webview reuse clean).
