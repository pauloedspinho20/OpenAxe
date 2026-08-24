# DI audition samples — placeholders

These 7 WAVs are **synthetic placeholders** (≈10 s, mono 48 kHz 16-bit) generated
for issue #273. They let the Input dialog's DI audition player be developed and
tested without waiting for real recordings.

Each file is a naïve sine-based tone (not a real guitar/bass DI) — good enough
to exercise the fetch → decode → graph path, mute-live-mic behaviour, and
looping. Replace them with original recordings at the same paths — no code
change needed, just drop the final `*.wav` files here:

- `guitar-clean.wav` — Clean arpeggio
- `guitar-rock.wav` — Rock rhythm / open chords
- `guitar-metal.wav` — High-gain chug / palm mute
- `guitar-funk.wav` — Funk percussive comping
- `bass-finger.wav` — Fingerstyle
- `bass-pick.wav` — Pick
- `bass-slap.wav` — Slap

See `apps/web/src/diSamples.ts` for the manifest. Keep filenames stable;
the bridge/desktop code expects these 7 ids. The final recordings should still
be mono 48 kHz WAV, ~8–15 s, peak-normalised to −1 dBFS and loop-safe.
