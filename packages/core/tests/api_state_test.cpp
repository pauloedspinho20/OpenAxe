// Issue #119's round-trip test: build a non-trivial rig through the extern
// "C" ABI (amp + cab + several effects + a mixer + a splitter), serialize it,
// load the document into a fresh graph, and assert every param (by SYMBOL),
// edge, trim and bypass matches. Also covers schemaVersion policy,
// partial-failure tolerance (#64), and loading the web app's existing legacy
// preset shape.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "openaxe/api.h"
#include "test_harness.h"

namespace {

constexpr int32_t kInRail = NAM_STUDIO_IN_RAIL;
constexpr int32_t kOutRail = NAM_STUDIO_OUT_RAIL;

// The non-trivial rig, built identically on two graphs so their block ids
// line up for comparison. The splitter fans out to cab/reverb/delay; the
// compressor branch feeds the mixer's fourth input directly:
//
//   IN -> noise-gate(0,0) -> amp(0,1) -> splitter(0,2) -+-> cab(0,3) -----+
//                                                       |-> reverb(1,3) --+|
//   IN -> compressor(2,0) ------------------------------> delay(2,3) ----+|-> mixer(0,4) -> OUT
//                                                       \-> ping-pong(3,3)+
void BuildRig(NamStudioGraph* g) {
  const int32_t gate = nam_studio_add_block(g, NAM_STUDIO_BLOCK_NOISE_GATE, 0, 0);
  const int32_t comp = nam_studio_add_block(g, NAM_STUDIO_BLOCK_COMPRESSOR, 2, 0);
  const int32_t amp = nam_studio_add_block(g, NAM_STUDIO_BLOCK_AMP, 0, 1);
  const int32_t split = nam_studio_add_block(g, NAM_STUDIO_BLOCK_SPLITTER, 0, 2);
  const int32_t cab = nam_studio_add_block(g, NAM_STUDIO_BLOCK_CAB, 0, 3);
  const int32_t reverb = nam_studio_add_block(g, NAM_STUDIO_BLOCK_REVERB, 1, 3);
  const int32_t delay = nam_studio_add_block(g, NAM_STUDIO_BLOCK_DELAY, 2, 3);
  const int32_t ppd = nam_studio_add_block(g, NAM_STUDIO_BLOCK_PING_PONG_DELAY, 3, 3);
  const int32_t mixer = nam_studio_add_block(g, NAM_STUDIO_BLOCK_MIXER, 0, 4);

  OPENAXE_EXPECT(nam_studio_connect(g, kInRail, 0, gate, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(g, kInRail, 0, comp, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(g, gate, 0, amp, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(g, amp, 0, split, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(g, split, 0, cab, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(g, split, 1, reverb, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(g, split, 2, delay, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(g, comp, 0, ppd, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(g, cab, 0, mixer, 0) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(g, reverb, 0, mixer, 1) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(g, delay, 0, mixer, 2) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(g, ppd, 0, mixer, 3) >= 0);
  OPENAXE_EXPECT(nam_studio_connect(g, mixer, 0, kOutRail, 0) >= 0);

  // Distinctive values everywhere, set BY SYMBOL via the info table (the same
  // path the loader must use).
  struct ParamWrite {
    int32_t block;
    const char* symbol;
    float value;
  };
  const ParamWrite writes[] = {
      {gate, "threshold", 0.42f},  {gate, "range", 0.9f},
      {comp, "threshold", -18.5f}, {comp, "ratio", 7.5f},
      {comp, "character", 3.0f},   {amp, "bass", 2.5f},
      {amp, "presence", -4.0f},    {cab, "ir_mix", 1.0f},
      {delay, "time", 420.0f},     {delay, "feedback", 0.55f},
      {delay, "tone", 3000.0f},    {delay, "model", 1.0f},
      {delay, "wow_depth", 2.5f},  {delay, "wow_rate", 0.9f},
      {ppd, "time", 333.0f},       {ppd, "feedback", 0.61f},
      {mixer, "in0_level", 0.8f},  {mixer, "in1_pan", -0.5f},
      {mixer, "in2_level", 1.2f},
  };
  for (const ParamWrite& w : writes) {
    const int32_t count = nam_studio_block_param_count(g, w.block);
    bool found = false;
    for (int32_t i = 0; i < count; ++i) {
      const char* symbol = nullptr;
      if (!nam_studio_block_param_info(g, w.block, i, nullptr, &symbol, nullptr, nullptr,
                                       nullptr)) {
        continue;
      }
      if (std::strcmp(symbol, w.symbol) == 0) {
        nam_studio_set_param(g, w.block, i, w.value);
        found = true;
        break;
      }
    }
    OPENAXE_EXPECT(found);  // the test itself only writes symbols that exist
    if (!found) {
      std::fprintf(stderr, "  (BuildRig: symbol '%s' not found)\n", w.symbol);
    }
  }

  nam_studio_set_reverb_algorithm(g, reverb, NAM_STUDIO_REVERB_ROOM);
  nam_studio_set_reverb_control(g, reverb, NAM_STUDIO_REVERB_ROOM_SIZE, 0.5f);
  nam_studio_set_reverb_control(g, reverb, NAM_STUDIO_REVERB_DAMPING, 0.3f);
  nam_studio_set_reverb_control(g, reverb, NAM_STUDIO_REVERB_WIDTH, 120.0f);
  nam_studio_set_reverb_control(g, reverb, NAM_STUDIO_REVERB_PREDELAY, 33.0f);
  nam_studio_set_reverb_control(g, reverb, NAM_STUDIO_REVERB_DRY_LEVEL, 30.0f);

  // Trims and bypass.
  nam_studio_set_block_input_trim(g, gate, 0.8f);
  nam_studio_set_block_output_trim(g, gate, 1.25f);
  nam_studio_set_block_output_trim(g, amp, 0.9f);
  nam_studio_set_block_input_trim(g, ppd, 1.1f);
  nam_studio_set_bypass(g, ppd, 1);
  nam_studio_set_bypass(g, comp, 1);

  nam_studio_set_master_level(g, 0.75f);
  nam_studio_set_master_muted(g, 1);
}

// Reads one param by symbol; NaN sentinel when absent.
float GetParamBySymbol(NamStudioGraph* g, int32_t block, const char* wanted) {
  const int32_t count = nam_studio_block_param_count(g, block);
  for (int32_t i = 0; i < count; ++i) {
    const char* symbol = nullptr;
    if (!nam_studio_block_param_info(g, block, i, nullptr, &symbol, nullptr, nullptr, nullptr)) {
      continue;
    }
    if (std::strcmp(symbol, wanted) == 0) return nam_studio_get_param(g, block, i);
  }
  return std::nanf("");
}

// Bit-exact param comparison between two rigs built from the same document.
// The wire format round-trips floats exactly, so equality (not approx) is the
// honest assertion - and it's what catches a silently remapped value.
void ExpectParamMatches(NamStudioGraph* a, NamStudioGraph* b, int32_t block,
                        const char* symbol) {
  const float va = GetParamBySymbol(a, block, symbol);
  const float vb = GetParamBySymbol(b, block, symbol);
  if (std::isnan(va)) {
    OPENAXE_EXPECT(std::isnan(vb));  // absent in both (e.g. skipped calibration)
    return;
  }
  if (va != vb) {
    std::fprintf(stderr, "  (param mismatch block %d '%s': %g vs %g)\n", block, symbol,
                 static_cast<double>(va), static_cast<double>(vb));
  }
  OPENAXE_EXPECT(va == vb);
}

}  // namespace

int main() {
  NamStudioGraph* source = nam_studio_graph_create();
  BuildRig(source);

  // ── Two-call sizing pattern ────────────────────────────────────────────
  const int32_t required = nam_studio_serialize_state(source, nullptr, 0);
  OPENAXE_EXPECT(required > 16);
  std::vector<char> small(static_cast<size_t>(required) / 2);
  OPENAXE_EXPECT(nam_studio_serialize_state(source, small.data(),
                                        static_cast<int32_t>(small.size())) == -1);
  std::vector<char> buffer(static_cast<size_t>(required));
  const int32_t written =
      nam_studio_serialize_state(source, buffer.data(), static_cast<int32_t>(buffer.size()));
  OPENAXE_EXPECT(written == required);
  OPENAXE_EXPECT(buffer.back() == '\0');
  const std::string document(buffer.data());

  // The document carries the schema stamp and symbol-keyed params.
  OPENAXE_EXPECT(document.find("\"schemaVersion\": 1") != std::string::npos);
  OPENAXE_EXPECT(document.find("\"ping-pong-delay\"") != std::string::npos);
  OPENAXE_EXPECT(document.find("\"time\": 333") != std::string::npos);
  OPENAXE_EXPECT(document.find("\"reverbAlgorithm\": \"room\"") != std::string::npos);
  OPENAXE_EXPECT(document.find("\"delayModel\": \"analog\"") != std::string::npos);

  // ── Round-trip into a fresh graph ──────────────────────────────────────
  NamStudioGraph* restored = nam_studio_graph_create();
  OPENAXE_EXPECT(nam_studio_load_state(restored, document.c_str()) ==
             NAM_STUDIO_LOAD_STATE_OK);

  // Blocks: same count and same kinds/positions in the same order (ids line
  // up because both rigs were built with identical AddBlock sequences).
  for (int32_t id = 0; id < 9; ++id) {
    const int32_t count_a = nam_studio_block_param_count(source, id);
    const int32_t count_b = nam_studio_block_param_count(restored, id);
    OPENAXE_EXPECT(count_a == count_b);
    for (int32_t i = 0; i < count_a; ++i) {
      const char* symbol = nullptr;
      if (!nam_studio_block_param_info(source, id, i, nullptr, &symbol, nullptr, nullptr,
                                       nullptr)) {
        OPENAXE_EXPECT(false);  // count said this index exists
        continue;
      }
      ExpectParamMatches(source, restored, id, symbol);
    }
    OPENAXE_EXPECT(nam_studio_is_bypassed(source, id) == nam_studio_is_bypassed(restored, id));
    OPENAXE_EXPECT(nam_studio_get_block_input_trim(source, id) ==
               nam_studio_get_block_input_trim(restored, id));
    OPENAXE_EXPECT(nam_studio_get_block_output_trim(source, id) ==
               nam_studio_get_block_output_trim(restored, id));
  }

  // Master bus restored too.
  OPENAXE_EXPECT(nam_studio_get_master_level(restored) == 0.75f);
  OPENAXE_EXPECT(nam_studio_is_master_muted(restored) == 1);

  // ── Edges: probed structurally, since the ABI has no edge enumeration ──
  // mixer.in1 is already fed by the reverb, so a second cable into it must
  // be rejected - which is only possible if that edge was restored.
  const int32_t cab = 4;
  const int32_t reverb = 5;
  const int32_t delay = 6;
  const int32_t ppd = 7;
  const int32_t mixer = 8;
  OPENAXE_EXPECT(nam_studio_connect(restored, cab, 0, mixer, 1) == -1);
  OPENAXE_EXPECT(nam_studio_connect(restored, reverb, 0, mixer, 2) == -1);
  OPENAXE_EXPECT(nam_studio_connect(restored, delay, 0, mixer, 3) == -1);
  OPENAXE_EXPECT(nam_studio_connect(restored, ppd, 0, mixer, 0) == -1);
  // The OUT rail's single input is taken by the mixer's output.
  OPENAXE_EXPECT(nam_studio_connect(restored, cab, 0, kOutRail, 0) == -1);
  // Every input jack of the restored rig is legitimately taken, so the
  // positive control adds a fresh block first: the gate fans out into it.
  const int32_t extra = nam_studio_add_block(restored, NAM_STUDIO_BLOCK_FLANGER, 2, 5);
  OPENAXE_EXPECT(nam_studio_connect(restored, 0 /*gate*/, 0, extra, 0) >= 0);
  // (`restored` is now deliberately dirty; the audio check below reloads a
  // fresh graph from the same document instead of reusing it.)

  // ── Audio equivalence: the strongest topology assertion ────────────────
  // Same input through both rigs must come out bit-identical (every DSP
  // object here is freshly constructed and deterministic). This catches any
  // edge, param or routing difference the per-field checks missed.
  constexpr int32_t kFrames = 256;
  float in_l[kFrames];
  float in_r[kFrames];
  for (int32_t i = 0; i < kFrames; ++i) {
    in_l[i] = 0.25f * std::sin(static_cast<float>(i) * 0.05f);
    in_r[i] = 0.2f * std::cos(static_cast<float>(i) * 0.03f);
  }
  float out_a[2][kFrames] = {};
  float out_b[2][kFrames] = {};
  nam_studio_set_master_muted(source, 0);
  nam_studio_set_master_muted(restored, 0);
  // Undo the sanity cable's effect on `restored`: it feeds mixer.in2 in
  // parallel with the delay, so instead rebuild the comparison rig from the
  // same document and leave both untouched.
  NamStudioGraph* clean = nam_studio_graph_create();
  OPENAXE_EXPECT(nam_studio_load_state(clean, document.c_str()) == NAM_STUDIO_LOAD_STATE_OK);

  // Serialize-after-load must reproduce the original document byte for byte:
  // if state ever diverges, this pinpoints it far better than an audio
  // mismatch would.
  {
    const int32_t needed2 = nam_studio_serialize_state(clean, nullptr, 0);
    std::vector<char> buf2(static_cast<size_t>(needed2));
    nam_studio_serialize_state(clean, buf2.data(), needed2);
    if (document != std::string(buf2.data())) {
      std::fprintf(stderr, "  (re-serialized document differs from the original)\n");
      std::FILE* f = std::fopen("/tmp/nam_state_orig.json", "w");
      if (f) {
        std::fputs(document.c_str(), f);
        std::fclose(f);
      }
      f = std::fopen("/tmp/nam_state_reload.json", "w");
      if (f) {
        std::fputs(buf2.data(), f);
        std::fclose(f);
      }
    }
    OPENAXE_EXPECT(document == std::string(buf2.data()));
  }

  nam_studio_reset(source, 48000.0, kFrames);
  nam_studio_reset(clean, 48000.0, kFrames);
  // Both rigs restore muted (that's what the document says); unmute so the
  // comparison hears anything at all.
  nam_studio_set_master_muted(source, 0);
  nam_studio_set_master_muted(clean, 0);
  const float* in_ptrs[2] = {in_l, in_r};
  float* out_a_ptrs[2] = {out_a[0], out_a[1]};
  float* out_c_ptrs[2] = {out_b[0], out_b[1]};
  for (int block = 0; block < 4; ++block) {
    nam_studio_process(source, in_ptrs, 2, out_a_ptrs, 2, kFrames);
    nam_studio_process(clean, in_ptrs, 2, out_c_ptrs, 2, kFrames);
  }
  bool identical = true;
  bool any_signal = false;
  float max_diff = 0.0f;
  float peak_a = 0.0f;
  float peak_b = 0.0f;
  int32_t first_bad = -1;
  for (int32_t i = 0; i < kFrames; ++i) {
    peak_a = std::max({peak_a, std::fabs(out_a[0][i]), std::fabs(out_a[1][i])});
    peak_b = std::max({peak_b, std::fabs(out_b[0][i]), std::fabs(out_b[1][i])});
    const float dl = std::fabs(out_a[0][i] - out_b[0][i]);
    const float dr = std::fabs(out_a[1][i] - out_b[1][i]);
    if (dl > max_diff || dr > max_diff) {
      max_diff = std::max(dl, dr);
      if (first_bad < 0) first_bad = i;
    }
    if ((dl != 0.0f || dr != 0.0f) && identical) {
      identical = false;
      std::fprintf(stderr,
                   "  (first audio divergence at frame %d: %.9g vs %.9g)\n", i,
                   static_cast<double>(out_a[0][i]), static_cast<double>(out_b[0][i]));
    }
    if (out_a[0][i] != 0.0f || out_a[1][i] != 0.0f) any_signal = true;
  }
  std::fprintf(stderr,
               "  (audio: identical=%d any_signal=%d peak_source=%.6g peak_reload=%.6g "
               "max_diff=%.9g first_bad=%d)\n",
               identical ? 1 : 0, any_signal ? 1 : 0, static_cast<double>(peak_a),
               static_cast<double>(peak_b), static_cast<double>(max_diff), first_bad);
  OPENAXE_EXPECT(identical);
  OPENAXE_EXPECT(any_signal);  // silence would make "identical" meaningless

  // ── Hard failures leave the graph untouched ────────────────────────────
  OPENAXE_EXPECT(nam_studio_load_state(clean, "{not json") == NAM_STUDIO_LOAD_STATE_PARSE_ERROR);
  OPENAXE_EXPECT(nam_studio_load_state(clean, "[1,2]") == NAM_STUDIO_LOAD_STATE_BAD_DOCUMENT);
  OPENAXE_EXPECT(nam_studio_load_state(clean, "{\"schemaVersion\": \"x\"}") ==
             NAM_STUDIO_LOAD_STATE_BAD_DOCUMENT);
  OPENAXE_EXPECT(nam_studio_load_state(clean, "{\"blocks\": []}") ==
             NAM_STUDIO_LOAD_STATE_BAD_DOCUMENT);
  OPENAXE_EXPECT(nam_studio_load_state(
                 clean, "{\"schemaVersion\": 99, \"blocks\": [], \"edges\": []}") ==
             NAM_STUDIO_LOAD_STATE_UNSUPPORTED_VERSION);
  // Untouched: the amp still answers with its full param table.
  OPENAXE_EXPECT(nam_studio_block_param_count(clean, 2) > 0);

  // schemaVersion 1 explicit == implicit.
  OPENAXE_EXPECT(nam_studio_load_state(
                 clean, R"({"schemaVersion": 1, "blocks": [], "edges": [],
                            "masterLevel": 0.5, "masterMuted": false})") ==
             NAM_STUDIO_LOAD_STATE_OK);
  OPENAXE_EXPECT(nam_studio_get_master_level(clean) == 0.5f);
  OPENAXE_EXPECT(nam_studio_block_param_count(clean, 2) == 0);  // old rig cleared

  // ── Partial-failure tolerance (#64): one bad entry never aborts ────────
  {
    NamStudioGraph* g = nam_studio_graph_create();
    const char* doc =
        R"({
          "schemaVersion": 1,
          "blocks": [
            { "id": "a", "kind": "chorus", "row": 0, "col": 0,
              "params": { "rate": 1.5, "depth": 0.7, "no_such_symbol": 3.0 } },
            { "id": "b", "kind": "teleporter", "row": 1, "col": 0, "params": {} },
            { "id": "c", "kind": "tremolo", "row": 2, "col": 0, "bypass": true,
              "params": { "rate": "fast" } },
            { "id": "c", "kind": "flanger", "row": 3, "col": 0, "params": {} }
          ],
          "edges": [
            { "from": { "blockId": "a", "port": 0 }, "to": { "blockId": "c", "port": 0 } },
            { "from": { "blockId": "ghost", "port": 0 }, "to": { "blockId": "a", "port": 0 } }
          ],
          "masterLevel": 0.9, "masterMuted": false
        })";
    OPENAXE_EXPECT(nam_studio_load_state(g, doc) == NAM_STUDIO_LOAD_STATE_OK);
    // chorus (a) + tremolo (c) restored - the teleporter and the duplicate-id
    // flanger are skipped, so tremolo lands on id 1. Unknown symbol on a,
    // non-numeric rate value on c: skipped params, not failures.
    OPENAXE_EXPECT(nam_studio_block_param_count(g, 0) == 5);   // chorus + mix
    OPENAXE_EXPECT(GetParamBySymbol(g, 0, "rate") == 1.5f);
    OPENAXE_EXPECT(GetParamBySymbol(g, 0, "depth") == 0.7f);
    OPENAXE_EXPECT(nam_studio_block_param_count(g, 1) == 6);   // tremolo + mix (stereo+mode)
    OPENAXE_EXPECT(nam_studio_is_bypassed(g, 1) == 1);
    {
      // The untouched rate stands - compared against a fresh tremolo rather
      // than a hardcoded default, so the test survives default retunes.
      NamStudioGraph* reference = nam_studio_graph_create();
      nam_studio_add_block(reference, NAM_STUDIO_BLOCK_TREMOLO, 0, 0);
      OPENAXE_EXPECT(GetParamBySymbol(g, 1, "rate") == GetParamBySymbol(reference, 0, "rate"));
      nam_studio_graph_destroy(reference);
    }
    // The valid edge survived: chorus -> tremolo means tremolo's input jack
    // is taken.
    OPENAXE_EXPECT(nam_studio_connect(g, 0, 0, 1, 0) == -1);
    nam_studio_graph_destroy(g);
  }

  // ── Legacy web preset shape: today's exported .json files load ─────────
  {
    NamStudioGraph* legacy = nam_studio_graph_create();
    // No schemaVersion (the field postdates these files), UI-level param
    // keys, reverb algorithm inside params, trims disguised as params,
    // IN/OUT rail names, and non-numeric block ids.
    const char* web_preset =
        R"({
          "id": "p1", "name": "My Rig", "tags": [], "favorite": false,
          "createdAt": 1700000000000, "updatedAt": 1700000001000,
          "blocks": [
            { "id": "amp1", "kind": "amp", "row": 0, "col": 1,
              "params": { "input_level": 1.5, "output_level": 0.8,
                          "bass": 1.0, "mid": 0.5, "treble": -1.0, "presence": 2.0 } },
            { "id": "verb1", "kind": "reverb", "row": 0, "col": 2,
              "params": { "reverbAlgorithm": "plate", "roomSize": 0.6,
                          "damping": 0.25, "width": 130, "dryLevel": 20 } },
            { "id": "dly1", "kind": "delay", "row": 1, "col": 3,
              "params": { "model": "tape", "time": 380, "feedback": 0.45 } }
          ],
          "edges": [
            { "from": { "blockId": "IN", "port": 0 }, "to": { "blockId": "amp1", "port": 0 } },
            { "from": { "blockId": "amp1", "port": 0 }, "to": { "blockId": "verb1", "port": 0 } },
            { "from": { "blockId": "verb1", "port": 0 }, "to": { "blockId": "dly1", "port": 0 } },
            { "from": { "blockId": "dly1", "port": 0 }, "to": { "blockId": "OUT", "port": 0 } }
          ],
          "masterLevel": 0.85, "masterMuted": false
        })";
    OPENAXE_EXPECT(nam_studio_load_state(legacy, web_preset) == NAM_STUDIO_LOAD_STATE_OK);

    // amp = block 0. The legacy input_level/output_level keys became TRIMS -
    // they must NOT have been written into the amp family's calibration
    // params (those stay untouched at their defaults).
    OPENAXE_EXPECT(nam_studio_get_block_input_trim(legacy, 0) == 1.5f);
    OPENAXE_EXPECT(nam_studio_get_block_output_trim(legacy, 0) == 0.8f);
    OPENAXE_EXPECT(GetParamBySymbol(legacy, 0, "input_level") == 0.0f);
    OPENAXE_EXPECT(GetParamBySymbol(legacy, 0, "bass") == 1.0f);

    // reverb = block 1: plate selected via the legacy select value, and the
    // abstractions mapped exactly as SetReverbControl would on a live rig.
    {
      NamStudioGraph* reference = nam_studio_graph_create();
      const int32_t rv = nam_studio_add_block(reference, NAM_STUDIO_BLOCK_REVERB, 0, 2);
      nam_studio_set_reverb_algorithm(reference, rv, NAM_STUDIO_REVERB_PLATE);
      nam_studio_set_reverb_control(reference, rv, NAM_STUDIO_REVERB_ROOM_SIZE, 0.6f);
      nam_studio_set_reverb_control(reference, rv, NAM_STUDIO_REVERB_DAMPING, 0.25f);
      nam_studio_set_reverb_control(reference, rv, NAM_STUDIO_REVERB_WIDTH, 130.0f);
      nam_studio_set_reverb_control(reference, rv, NAM_STUDIO_REVERB_DRY_LEVEL, 20.0f);
      for (int32_t i = 0; i < nam_studio_block_param_count(reference, rv); ++i) {
        const char* symbol = nullptr;
        if (!nam_studio_block_param_info(reference, rv, i, nullptr, &symbol, nullptr, nullptr,
                                         nullptr)) {
          OPENAXE_EXPECT(false);
          continue;
        }
        OPENAXE_EXPECT(GetParamBySymbol(reference, rv, symbol) ==
                   GetParamBySymbol(legacy, 1, symbol));
      }
      nam_studio_graph_destroy(reference);
    }

    // delay = block 2: 'tape' resolved from the string select.
    OPENAXE_EXPECT(GetParamBySymbol(legacy, 2, "model") == 2.0f);
    OPENAXE_EXPECT(GetParamBySymbol(legacy, 2, "time") == 380.0f);

    // Rails wired through their grid names.
    OPENAXE_EXPECT(nam_studio_is_master_muted(legacy) == 0);
    nam_studio_graph_destroy(legacy);
  }

  // ── Amp calibration is only serialized when it exists (#119's trap) ────
  {
    // A fresh amp has no model and no explicit calibration: its input_level/
    // output_level slots must NOT appear in the document at all, so restoring
    // can never fabricate a dBu override over a model loaded later.
    NamStudioGraph* bare = nam_studio_graph_create();
    const int32_t amp = nam_studio_add_block(bare, NAM_STUDIO_BLOCK_AMP, 0, 0);
    const int32_t needed = nam_studio_serialize_state(bare, nullptr, 0);
    std::vector<char> buf(static_cast<size_t>(needed));
    nam_studio_serialize_state(bare, buf.data(), needed);
    OPENAXE_EXPECT(std::strstr(buf.data(), "input_level") == nullptr);
    OPENAXE_EXPECT(std::strstr(buf.data(), "output_level") == nullptr);

    // ...but once the caller explicitly sets one, it must round-trip.
    {
      const int32_t count = nam_studio_block_param_count(bare, amp);
      for (int32_t i = 0; i < count; ++i) {
        const char* symbol = nullptr;
        if (!nam_studio_block_param_info(bare, amp, i, nullptr, &symbol, nullptr, nullptr,
                                         nullptr)) {
          continue;
        }
        if (std::strcmp(symbol, "input_level") == 0) {
          nam_studio_set_param(bare, amp, i, -6.5f);
          break;
        }
      }
      const int32_t needed2 = nam_studio_serialize_state(bare, nullptr, 0);
      std::vector<char> buf2(static_cast<size_t>(needed2));
      nam_studio_serialize_state(bare, buf2.data(), needed2);
      OPENAXE_EXPECT(std::strstr(buf2.data(), "\"input_level\": -6.5") != nullptr);

      NamStudioGraph* reloaded = nam_studio_graph_create();
      OPENAXE_EXPECT(nam_studio_load_state(reloaded, buf2.data()) == NAM_STUDIO_LOAD_STATE_OK);
      OPENAXE_EXPECT(GetParamBySymbol(reloaded, 0, "input_level") == -6.5f);
      nam_studio_graph_destroy(reloaded);
    }
    nam_studio_graph_destroy(bare);
  }

  // ── Non-numeric document ids survive the round trip ─────────────────────
  {
    NamStudioGraph* g = nam_studio_graph_create();
    const char* doc =
        R"({"schemaVersion": 1,
            "blocks": [
              { "id": "amp1", "kind": "compressor", "row": 0, "col": 0,
                "params": { "threshold": -20.0 } },
              { "id": "z", "kind": "eq", "row": 1, "col": 1,
                "params": { "band0_gain": 3.5 } }
            ],
            "edges": [
              { "from": { "blockId": "amp1", "port": 0 },
                "to": { "blockId": "z", "port": 0 } }
            ],
            "masterLevel": 1.0, "masterMuted": false})";
    OPENAXE_EXPECT(nam_studio_load_state(g, doc) == NAM_STUDIO_LOAD_STATE_OK);
    OPENAXE_EXPECT(GetParamBySymbol(g, 0, "threshold") == -20.0f);
    OPENAXE_EXPECT(GetParamBySymbol(g, 1, "band0_gain") == 3.5f);
    // The edge resolved through the id map: z's input jack is taken.
    OPENAXE_EXPECT(nam_studio_connect(g, 1, 0, 0, 0) == -1);
    nam_studio_graph_destroy(g);
  }

  // ── Phase-2 kinds (issue #268) serialize and restore ────────────────────
  {
    NamStudioGraph* g = nam_studio_graph_create();
    struct KindWrite {
      int32_t block; // index into blocks[]
      const char* symbol;
      float value;
    };
    const KindWrite writes[] = {
        {0, "frequency", 700.0f},
        {0, "drive", 0.8f},
        {1, "type", 2.0f},
        {1, "frequency", 900.0f},
        {1, "mode", 1.0f},
        {2, "pitch", -5.0f},
        {2, "detune_cents", 12.0f},
        {3, "time", 500.0f},
        {3, "freeze", 1.0f},
        {3, "character", 0.7f},
        {4, "speed", 2.0f},
        {4, "crossover", 950.0f},
    };
    int32_t blocks[5] = {0};
    int next = 0;
    blocks[next++] = nam_studio_add_block(g, NAM_STUDIO_BLOCK_RING_MOD, 0, 0);
    blocks[next++] = nam_studio_add_block(g, NAM_STUDIO_BLOCK_FILTER, 0, 1);
    blocks[next++] = nam_studio_add_block(g, NAM_STUDIO_BLOCK_PITCH_SHIFTER, 0, 2);
    blocks[next++] = nam_studio_add_block(g, NAM_STUDIO_BLOCK_GRANULAR_DELAY, 0, 3);
    blocks[next++] = nam_studio_add_block(g, NAM_STUDIO_BLOCK_ROTARY, 0, 4);
    for (const KindWrite& w : writes) {
      bool found = false;
      for (int32_t i = 0; i < nam_studio_block_param_count(g, blocks[w.block]); ++i) {
        const char* symbol = nullptr;
        if (!nam_studio_block_param_info(g, blocks[w.block], i, nullptr, &symbol, nullptr,
                                         nullptr, nullptr)) {
          continue;
        }
        if (std::strcmp(symbol, w.symbol) == 0) {
          nam_studio_set_param(g, blocks[w.block], i, w.value);
          found = true;
          break;
        }
      }
      OPENAXE_EXPECT(found);
    }
    // Phase-2 kinds serialize under their kind string names.
    const int32_t needed = nam_studio_serialize_state(g, nullptr, 0);
    std::vector<char> buf(static_cast<size_t>(needed));
    nam_studio_serialize_state(g, buf.data(), needed);
    OPENAXE_EXPECT(std::strstr(buf.data(), "\"ring-mod\"") != nullptr);
    OPENAXE_EXPECT(std::strstr(buf.data(), "\"granular-delay\"") != nullptr);
    OPENAXE_EXPECT(std::strstr(buf.data(), "\"rotary\"") != nullptr);
    OPENAXE_EXPECT(std::strstr(buf.data(), "\"pitch-shifter\"") != nullptr);
    OPENAXE_EXPECT(std::strstr(buf.data(), "\"filter\"") != nullptr);

    NamStudioGraph* r = nam_studio_graph_create();
    OPENAXE_EXPECT(nam_studio_load_state(r, buf.data()) == NAM_STUDIO_LOAD_STATE_OK);
    for (const KindWrite& w : writes) {
      OPENAXE_EXPECT(GetParamBySymbol(r, blocks[w.block], w.symbol) == w.value);
    }
    nam_studio_graph_destroy(r);
    nam_studio_graph_destroy(g);
  }

  nam_studio_graph_destroy(source);
  nam_studio_graph_destroy(restored);
  nam_studio_graph_destroy(clean);

  if (::openaxe::test::g_failures == 0) {
    std::printf("api_state_test passed\n");
    return 0;
  }
  std::printf("api_state_test FAILED (%d)\n", ::openaxe::test::g_failures);
  return 1;
}
