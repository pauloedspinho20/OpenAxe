# SoundFonts for the song player (#165)

The song player renders General MIDI via TinySoundFont (`packages/core/third_party/tinysoundfont`).

## Default font

**FluidR3_GM** — MIT license, ~141 MB full. We ship a subset (bank 0 only, ~5–8 MB) as
`FluidR3_GM.sf2` in this directory when the subset is generated:

```bash
# Example subset generation (requires fluid-soundfont source + sf2tools):
python scripts/subset-soundfont.py --input FluidR3_GM.sf2 --banks 0 --output apps/web/public/soundfonts/FluidR3_GM.sf2
```

The file is **not** committed in this phase (Phase 3) — the loader (`src/soundfonts/soundfontLoader.ts`)
lazy-fetches `/soundfonts/FluidR3_GM.sf2` on first song play and falls back to the CDN
(`cdn.jsdelivr.net/gh/FluidSynth/fluid-soundfont`). The fetched Blob is cached in IndexedDB
`assets` under `soundfont:default` (pattern in `assetCache.ts`), so the next launch is offline.

For local testing without the large file, place any small MIT-licensed GM font here
(e.g., `GeneralUser_GS.sf2` subset) and update `DEFAULT_SOUNDFONT_URL` in the loader.

## User-supplied fonts

The settings UI accepts `.sf2` / `.sf3` uploads (size limit `MAX_SOUNDFONT_BYTES = 32 MB`,
same as NAM models). Uploads are validated (`assertSoundfontFile` + RIFF check),
cached as `soundfont:user:<name>` and promoted to `soundfont:default` so the next
song uses it. See `THIRD_PARTY_NOTICES.md` for attribution when adding a new font.

## Licensing

Any bundled font must be MIT/BSD/CC0 and GPLv3-compatible. FluidR3_GM is MIT
(https://github.com/FluidSynth/fluid-soundfont). Add a row to `THIRD_PARTY_NOTICES.md`
when vendoring a font.
