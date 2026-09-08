// Issue #119's round-trip test: build a non-trivial rig through the extern
// "C" ABI (amp + cab + several effects + a mixer), serialize it,
// load the document into a fresh graph, and assert every param (by SYMBOL),
// edge, trim and bypass matches. Also covers schemaVersion policy,
// partial-failure tolerance (#64), and loading the web app's existing legacy
// preset shape.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "openaxe/api.h"
#include "openaxe/generated/enabled_blocks.h"
#include "test_harness.h"

namespace {

constexpr int32_t kInRail = OPENAXE_IN_RAIL;
constexpr int32_t kOutRail = OPENAXE_OUT_RAIL;

// The non-trivial rig, built identically on two graphs so their block ids
// line up for comparison. The amp fans out to cab/reverb/delay - three edges
// off its single output port, which is all the removed splitter kind ever was
// once its
// per-output levels are gone - and the compressor branch feeds the mixer's
// fourth input directly:
//
//   IN -> noise-gate(0,0) -> amp(0,1) -+-> cab(0,3) -----+
//                                      |-> reverb(1,3) --+|
//   IN -> compressor(2,0) -------------> delay(2,3) ----+|-> mixer(0,4) -> OUT
//                                      \-> delay/ping-pong(3,3)+
void BuildRig(OpenAxeGraph* g) {
  const int32_t gate = openaxe_add_block(g, OPENAXE_BLOCK_NOISE_GATE, 0, 0);
  const int32_t comp = openaxe_add_block(g, OPENAXE_BLOCK_COMPRESSOR, 2, 0);
  const int32_t amp = openaxe_add_block(g, OPENAXE_BLOCK_AMP, 0, 1);
  const int32_t cab = openaxe_add_block(g, OPENAXE_BLOCK_CAB, 0, 3);
  const int32_t reverb = openaxe_add_block(g, OPENAXE_BLOCK_REVERB, 1, 3);
  const int32_t delay = openaxe_add_block(g, OPENAXE_BLOCK_DELAY, 2, 3);
  // A second Delay, put into ping-pong mode below - the standalone
  // ping-pong-delay kind was folded into Delay in #314.
  const int32_t ppd = openaxe_add_block(g, OPENAXE_BLOCK_DELAY, 3, 3);
  const int32_t mixer = openaxe_add_block(g, OPENAXE_BLOCK_MIXER, 0, 4);

  OPENAXE_EXPECT(openaxe_connect(g, kInRail, 0, gate, 0) >= 0);
  OPENAXE_EXPECT(openaxe_connect(g, kInRail, 0, comp, 0) >= 0);
  OPENAXE_EXPECT(openaxe_connect(g, gate, 0, amp, 0) >= 0);
  OPENAXE_EXPECT(openaxe_connect(g, amp, 0, cab, 0) >= 0);
  OPENAXE_EXPECT(openaxe_connect(g, amp, 0, reverb, 0) >= 0);
  OPENAXE_EXPECT(openaxe_connect(g, amp, 0, delay, 0) >= 0);
  OPENAXE_EXPECT(openaxe_connect(g, comp, 0, ppd, 0) >= 0);
  OPENAXE_EXPECT(openaxe_connect(g, cab, 0, mixer, 0) >= 0);
  OPENAXE_EXPECT(openaxe_connect(g, reverb, 0, mixer, 1) >= 0);
  OPENAXE_EXPECT(openaxe_connect(g, delay, 0, mixer, 2) >= 0);
  OPENAXE_EXPECT(openaxe_connect(g, ppd, 0, mixer, 3) >= 0);
  OPENAXE_EXPECT(openaxe_connect(g, mixer, 0, kOutRail, 0) >= 0);

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
      {ppd, "stereo_mode", 1.0f}, {ppd, "width", 0.75f},
      {mixer, "in0_level", 0.8f},  {mixer, "in1_pan", -0.5f},
      {mixer, "in2_level", 1.2f},
  };
  for (const ParamWrite& w : writes) {
    const int32_t count = openaxe_block_param_count(g, w.block);
    bool found = false;
    for (int32_t i = 0; i < count; ++i) {
      const char* symbol = nullptr;
      if (!openaxe_block_param_info(g, w.block, i, nullptr, &symbol, nullptr, nullptr,
                                       nullptr)) {
        continue;
      }
      if (std::strcmp(symbol, w.symbol) == 0) {
        openaxe_set_param(g, w.block, i, w.value);
        found = true;
        break;
      }
    }
    OPENAXE_EXPECT(found);  // the test itself only writes symbols that exist
    if (!found) {
      std::fprintf(stderr, "  (BuildRig: symbol '%s' not found)\n", w.symbol);
    }
  }

  openaxe_set_reverb_algorithm(g, reverb, OPENAXE_REVERB_ROOM);
  openaxe_set_reverb_control(g, reverb, OPENAXE_REVERB_ROOM_SIZE, 0.5f);
  openaxe_set_reverb_control(g, reverb, OPENAXE_REVERB_DAMPING, 0.3f);
  openaxe_set_reverb_control(g, reverb, OPENAXE_REVERB_WIDTH, 120.0f);
  openaxe_set_reverb_control(g, reverb, OPENAXE_REVERB_PREDELAY, 33.0f);
  openaxe_set_reverb_control(g, reverb, OPENAXE_REVERB_DRY_LEVEL, 30.0f);

  // Trims and bypass.
  openaxe_set_block_input_trim(g, gate, 0.8f);
  openaxe_set_block_output_trim(g, gate, 1.25f);
  openaxe_set_block_output_trim(g, amp, 0.9f);
  openaxe_set_block_input_trim(g, ppd, 1.1f);
  openaxe_set_bypass(g, ppd, 1);
  openaxe_set_bypass(g, comp, 1);

  openaxe_set_master_level(g, 0.75f);
  openaxe_set_master_muted(g, 1);
}

// Reads one param by symbol; NaN sentinel when absent.
float GetParamBySymbol(OpenAxeGraph* g, int32_t block, const char* wanted) {
  const int32_t count = openaxe_block_param_count(g, block);
  for (int32_t i = 0; i < count; ++i) {
    const char* symbol = nullptr;
    if (!openaxe_block_param_info(g, block, i, nullptr, &symbol, nullptr, nullptr, nullptr)) {
      continue;
    }
    if (std::strcmp(symbol, wanted) == 0) return openaxe_get_param(g, block, i);
  }
  return std::nanf("");
}

// Bit-exact param comparison between two rigs built from the same document.
// The wire format round-trips floats exactly, so equality (not approx) is the
// honest assertion - and it's what catches a silently remapped value.
void ExpectParamMatches(OpenAxeGraph* a, OpenAxeGraph* b, int32_t block,
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
  OpenAxeGraph* source = openaxe_graph_create();
  BuildRig(source);

  // ── Two-call sizing pattern ────────────────────────────────────────────
  const int32_t required = openaxe_serialize_state(source, nullptr, 0);
  OPENAXE_EXPECT(required > 16);
  std::vector<char> small(static_cast<size_t>(required) / 2);
  OPENAXE_EXPECT(openaxe_serialize_state(source, small.data(),
                                        static_cast<int32_t>(small.size())) == -1);
  std::vector<char> buffer(static_cast<size_t>(required));
  const int32_t written =
      openaxe_serialize_state(source, buffer.data(), static_cast<int32_t>(buffer.size()));
  OPENAXE_EXPECT(written == required);
  OPENAXE_EXPECT(buffer.back() == '\0');
  const std::string document(buffer.data());

  // The document carries the schema stamp and symbol-keyed params.
  OPENAXE_EXPECT(document.find("\"schemaVersion\": 1") != std::string::npos);
  // The ping-pong block is a Delay carrying stereo_mode = 1 now (#314).
  OPENAXE_EXPECT(document.find("\"stereo_mode\": 1") != std::string::npos);
  OPENAXE_EXPECT(document.find("\"time\": 333") != std::string::npos);
  OPENAXE_EXPECT(document.find("\"reverbAlgorithm\": \"room\"") != std::string::npos);
  OPENAXE_EXPECT(document.find("\"delayModel\": \"analog\"") != std::string::npos);

  // ── Round-trip into a fresh graph ──────────────────────────────────────
  OpenAxeGraph* restored = openaxe_graph_create();
  OPENAXE_EXPECT(openaxe_load_state(restored, document.c_str()) ==
             OPENAXE_LOAD_STATE_OK);

  // Blocks: same count and same kinds/positions in the same order (ids line
  // up because both rigs were built with identical AddBlock sequences).
  for (int32_t id = 0; id < 9; ++id) {
    const int32_t count_a = openaxe_block_param_count(source, id);
    const int32_t count_b = openaxe_block_param_count(restored, id);
    OPENAXE_EXPECT(count_a == count_b);
    for (int32_t i = 0; i < count_a; ++i) {
      const char* symbol = nullptr;
      if (!openaxe_block_param_info(source, id, i, nullptr, &symbol, nullptr, nullptr,
                                       nullptr)) {
        OPENAXE_EXPECT(false);  // count said this index exists
        continue;
      }
      ExpectParamMatches(source, restored, id, symbol);
    }
    OPENAXE_EXPECT(openaxe_is_bypassed(source, id) == openaxe_is_bypassed(restored, id));
    OPENAXE_EXPECT(openaxe_get_block_input_trim(source, id) ==
               openaxe_get_block_input_trim(restored, id));
    OPENAXE_EXPECT(openaxe_get_block_output_trim(source, id) ==
               openaxe_get_block_output_trim(restored, id));
  }

  // Master bus restored too.
  OPENAXE_EXPECT(openaxe_get_master_level(restored) == 0.75f);
  OPENAXE_EXPECT(openaxe_is_master_muted(restored) == 1);

  // ── Edges: probed structurally, since the ABI has no edge enumeration ──
  // mixer.in1 is already fed by the reverb, so a second cable into it must
  // be rejected - which is only possible if that edge was restored.
  const int32_t cab = 4;
  const int32_t reverb = 5;
  const int32_t delay = 6;
  const int32_t ppd = 7;
  const int32_t mixer = 8;
  OPENAXE_EXPECT(openaxe_connect(restored, cab, 0, mixer, 1) == -1);
  OPENAXE_EXPECT(openaxe_connect(restored, reverb, 0, mixer, 2) == -1);
  OPENAXE_EXPECT(openaxe_connect(restored, delay, 0, mixer, 3) == -1);
  OPENAXE_EXPECT(openaxe_connect(restored, ppd, 0, mixer, 0) == -1);
  // The OUT rail's single input is taken by the mixer's output.
  OPENAXE_EXPECT(openaxe_connect(restored, cab, 0, kOutRail, 0) == -1);
  // Every input jack of the restored rig is legitimately taken, so the
  // positive control adds a fresh block first: the gate fans out into it.
  const int32_t extra = openaxe_add_block(restored, OPENAXE_BLOCK_FLANGER, 2, 5);
  OPENAXE_EXPECT(openaxe_connect(restored, 0 /*gate*/, 0, extra, 0) >= 0);
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
  openaxe_set_master_muted(source, 0);
  openaxe_set_master_muted(restored, 0);
  // Undo the sanity cable's effect on `restored`: it feeds mixer.in2 in
  // parallel with the delay, so instead rebuild the comparison rig from the
  // same document and leave both untouched.
  OpenAxeGraph* clean = openaxe_graph_create();
  OPENAXE_EXPECT(openaxe_load_state(clean, document.c_str()) == OPENAXE_LOAD_STATE_OK);

  // Serialize-after-load must reproduce the original document byte for byte:
  // if state ever diverges, this pinpoints it far better than an audio
  // mismatch would.
  {
    const int32_t needed2 = openaxe_serialize_state(clean, nullptr, 0);
    std::vector<char> buf2(static_cast<size_t>(needed2));
    openaxe_serialize_state(clean, buf2.data(), needed2);
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

  openaxe_reset(source, 48000.0, kFrames);
  openaxe_reset(clean, 48000.0, kFrames);
  // Both rigs restore muted (that's what the document says); unmute so the
  // comparison hears anything at all.
  openaxe_set_master_muted(source, 0);
  openaxe_set_master_muted(clean, 0);
  const float* in_ptrs[2] = {in_l, in_r};
  float* out_a_ptrs[2] = {out_a[0], out_a[1]};
  float* out_c_ptrs[2] = {out_b[0], out_b[1]};
  for (int block = 0; block < 4; ++block) {
    openaxe_process(source, in_ptrs, 2, out_a_ptrs, 2, kFrames);
    openaxe_process(clean, in_ptrs, 2, out_c_ptrs, 2, kFrames);
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
  OPENAXE_EXPECT(openaxe_load_state(clean, "{not json") == OPENAXE_LOAD_STATE_PARSE_ERROR);
  OPENAXE_EXPECT(openaxe_load_state(clean, "[1,2]") == OPENAXE_LOAD_STATE_BAD_DOCUMENT);
  OPENAXE_EXPECT(openaxe_load_state(clean, "{\"schemaVersion\": \"x\"}") ==
             OPENAXE_LOAD_STATE_BAD_DOCUMENT);
  OPENAXE_EXPECT(openaxe_load_state(clean, "{\"blocks\": []}") ==
             OPENAXE_LOAD_STATE_BAD_DOCUMENT);
  OPENAXE_EXPECT(openaxe_load_state(
                 clean, "{\"schemaVersion\": 99, \"blocks\": [], \"edges\": []}") ==
             OPENAXE_LOAD_STATE_UNSUPPORTED_VERSION);
  // Untouched: the amp still answers with its full param table.
  OPENAXE_EXPECT(openaxe_block_param_count(clean, 2) > 0);

  // schemaVersion 1 explicit == implicit.
  OPENAXE_EXPECT(openaxe_load_state(
                 clean, R"({"schemaVersion": 1, "blocks": [], "edges": [],
                            "masterLevel": 0.5, "masterMuted": false})") ==
             OPENAXE_LOAD_STATE_OK);
  OPENAXE_EXPECT(openaxe_get_master_level(clean) == 0.5f);
  OPENAXE_EXPECT(openaxe_block_param_count(clean, 2) == 0);  // old rig cleared

  // ── Partial-failure tolerance (#64): one bad entry never aborts ────────
  {
    OpenAxeGraph* g = openaxe_graph_create();
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
    OPENAXE_EXPECT(openaxe_load_state(g, doc) == OPENAXE_LOAD_STATE_OK);
    // chorus (a) + tremolo (c) restored - the teleporter and the duplicate-id
    // flanger are skipped, so tremolo lands on id 1. Unknown symbol on a,
    // non-numeric rate value on c: skipped params, not failures.
    OPENAXE_EXPECT(openaxe_block_param_count(g, 0) == 6);   // chorus (incl. stereo) + mix
    OPENAXE_EXPECT(GetParamBySymbol(g, 0, "rate") == 1.5f);
    OPENAXE_EXPECT(GetParamBySymbol(g, 0, "depth") == 0.7f);
    OPENAXE_EXPECT(openaxe_block_param_count(g, 1) == 6);   // tremolo + mix (stereo+mode)
    OPENAXE_EXPECT(openaxe_is_bypassed(g, 1) == 1);
    {
      // The untouched rate stands - compared against a fresh tremolo rather
      // than a hardcoded default, so the test survives default retunes.
      OpenAxeGraph* reference = openaxe_graph_create();
      openaxe_add_block(reference, OPENAXE_BLOCK_TREMOLO, 0, 0);
      OPENAXE_EXPECT(GetParamBySymbol(g, 1, "rate") == GetParamBySymbol(reference, 0, "rate"));
      openaxe_graph_destroy(reference);
    }
    // The valid edge survived: chorus -> tremolo means tremolo's input jack
    // is taken.
    OPENAXE_EXPECT(openaxe_connect(g, 0, 0, 1, 0) == -1);
    openaxe_graph_destroy(g);
  }

  // ── Legacy web preset shape: today's exported .json files load ─────────
  {
    OpenAxeGraph* legacy = openaxe_graph_create();
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
    OPENAXE_EXPECT(openaxe_load_state(legacy, web_preset) == OPENAXE_LOAD_STATE_OK);

    // amp = block 0. The legacy input_level/output_level keys became TRIMS -
    // they must NOT have been written into the amp family's calibration
    // params (those stay untouched at their defaults).
    OPENAXE_EXPECT(openaxe_get_block_input_trim(legacy, 0) == 1.5f);
    OPENAXE_EXPECT(openaxe_get_block_output_trim(legacy, 0) == 0.8f);
    OPENAXE_EXPECT(GetParamBySymbol(legacy, 0, "input_level") == 0.0f);
    OPENAXE_EXPECT(GetParamBySymbol(legacy, 0, "bass") == 1.0f);

    // reverb = block 1: plate selected via the legacy select value, and the
    // abstractions mapped exactly as SetReverbControl would on a live rig.
    {
      OpenAxeGraph* reference = openaxe_graph_create();
      const int32_t rv = openaxe_add_block(reference, OPENAXE_BLOCK_REVERB, 0, 2);
      openaxe_set_reverb_algorithm(reference, rv, OPENAXE_REVERB_PLATE);
      openaxe_set_reverb_control(reference, rv, OPENAXE_REVERB_ROOM_SIZE, 0.6f);
      openaxe_set_reverb_control(reference, rv, OPENAXE_REVERB_DAMPING, 0.25f);
      openaxe_set_reverb_control(reference, rv, OPENAXE_REVERB_WIDTH, 130.0f);
      openaxe_set_reverb_control(reference, rv, OPENAXE_REVERB_DRY_LEVEL, 20.0f);
      for (int32_t i = 0; i < openaxe_block_param_count(reference, rv); ++i) {
        const char* symbol = nullptr;
        if (!openaxe_block_param_info(reference, rv, i, nullptr, &symbol, nullptr, nullptr,
                                         nullptr)) {
          OPENAXE_EXPECT(false);
          continue;
        }
        OPENAXE_EXPECT(GetParamBySymbol(reference, rv, symbol) ==
                   GetParamBySymbol(legacy, 1, symbol));
      }
      openaxe_graph_destroy(reference);
    }

    // delay = block 2: 'tape' resolved from the string select.
    OPENAXE_EXPECT(GetParamBySymbol(legacy, 2, "model") == 2.0f);
    OPENAXE_EXPECT(GetParamBySymbol(legacy, 2, "time") == 380.0f);

    // Rails wired through their grid names.
    OPENAXE_EXPECT(openaxe_is_master_muted(legacy) == 0);
    openaxe_graph_destroy(legacy);
  }

  // ── Amp calibration is only serialized when it exists (#119's trap) ────
  {
    // A fresh amp has no model and no explicit calibration: its input_level/
    // output_level slots must NOT appear in the document at all, so restoring
    // can never fabricate a dBu override over a model loaded later.
    OpenAxeGraph* bare = openaxe_graph_create();
    const int32_t amp = openaxe_add_block(bare, OPENAXE_BLOCK_AMP, 0, 0);
    const int32_t needed = openaxe_serialize_state(bare, nullptr, 0);
    std::vector<char> buf(static_cast<size_t>(needed));
    openaxe_serialize_state(bare, buf.data(), needed);
    OPENAXE_EXPECT(std::strstr(buf.data(), "input_level") == nullptr);
    OPENAXE_EXPECT(std::strstr(buf.data(), "output_level") == nullptr);

    // ...but once the caller explicitly sets one, it must round-trip.
    {
      const int32_t count = openaxe_block_param_count(bare, amp);
      for (int32_t i = 0; i < count; ++i) {
        const char* symbol = nullptr;
        if (!openaxe_block_param_info(bare, amp, i, nullptr, &symbol, nullptr, nullptr,
                                         nullptr)) {
          continue;
        }
        if (std::strcmp(symbol, "input_level") == 0) {
          openaxe_set_param(bare, amp, i, -6.5f);
          break;
        }
      }
      const int32_t needed2 = openaxe_serialize_state(bare, nullptr, 0);
      std::vector<char> buf2(static_cast<size_t>(needed2));
      openaxe_serialize_state(bare, buf2.data(), needed2);
      OPENAXE_EXPECT(std::strstr(buf2.data(), "\"input_level\": -6.5") != nullptr);

      OpenAxeGraph* reloaded = openaxe_graph_create();
      OPENAXE_EXPECT(openaxe_load_state(reloaded, buf2.data()) == OPENAXE_LOAD_STATE_OK);
      OPENAXE_EXPECT(GetParamBySymbol(reloaded, 0, "input_level") == -6.5f);
      openaxe_graph_destroy(reloaded);
    }
    openaxe_graph_destroy(bare);
  }

  // ── Non-numeric document ids survive the round trip ─────────────────────
  {
    OpenAxeGraph* g = openaxe_graph_create();
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
    OPENAXE_EXPECT(openaxe_load_state(g, doc) == OPENAXE_LOAD_STATE_OK);
    OPENAXE_EXPECT(GetParamBySymbol(g, 0, "threshold") == -20.0f);
    OPENAXE_EXPECT(GetParamBySymbol(g, 1, "band0_gain") == 3.5f);
    // The edge resolved through the id map: z's input jack is taken.
    OPENAXE_EXPECT(openaxe_connect(g, 1, 0, 0, 0) == -1);
    openaxe_graph_destroy(g);
  }

  // ── Phase-2 kinds (issue #268) serialize and restore ────────────────────
  {
    OpenAxeGraph* g = openaxe_graph_create();
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
    blocks[next++] = openaxe_add_block(g, OPENAXE_BLOCK_RING_MOD, 0, 0);
    blocks[next++] = openaxe_add_block(g, OPENAXE_BLOCK_FILTER, 0, 1);
    blocks[next++] = openaxe_add_block(g, OPENAXE_BLOCK_PITCH_SHIFTER, 0, 2);
    blocks[next++] = openaxe_add_block(g, OPENAXE_BLOCK_GRANULAR_DELAY, 0, 3);
    blocks[next++] = openaxe_add_block(g, OPENAXE_BLOCK_ROTARY, 0, 4);
    for (const KindWrite& w : writes) {
      // A refused block (-1) is a kind this build compiled out - skip it
      // rather than hunting for params on a block that was never created.
      if (blocks[w.block] < 0) continue;
      bool found = false;
      for (int32_t i = 0; i < openaxe_block_param_count(g, blocks[w.block]); ++i) {
        const char* symbol = nullptr;
        if (!openaxe_block_param_info(g, blocks[w.block], i, nullptr, &symbol, nullptr,
                                         nullptr, nullptr)) {
          continue;
        }
        if (std::strcmp(symbol, w.symbol) == 0) {
          openaxe_set_param(g, blocks[w.block], i, w.value);
          found = true;
          break;
        }
      }
      OPENAXE_EXPECT(found);
    }
    // Phase-2 kinds serialize under their kind string names.
    const int32_t needed = openaxe_serialize_state(g, nullptr, 0);
    std::vector<char> buf(static_cast<size_t>(needed));
    openaxe_serialize_state(g, buf.data(), needed);
    // ring-mod, granular-delay, filter and pitch-shifter can be compiled
    // out (#313), in which case add_block refused them above and they are
    // legitimately absent.
    if (openaxe::blocks::IsCompiled(openaxe::graph::BlockKind::kRingMod)) {
      OPENAXE_EXPECT(std::strstr(buf.data(), "\"ring-mod\"") != nullptr);
    }
    if (openaxe::blocks::IsCompiled(openaxe::graph::BlockKind::kGranularDelay)) {
      OPENAXE_EXPECT(std::strstr(buf.data(), "\"granular-delay\"") != nullptr);
    }
    OPENAXE_EXPECT(std::strstr(buf.data(), "\"rotary\"") != nullptr);
    if (openaxe::blocks::IsCompiled(openaxe::graph::BlockKind::kPitchShifter)) {
      OPENAXE_EXPECT(std::strstr(buf.data(), "\"pitch-shifter\"") != nullptr);
    }
    if (openaxe::blocks::IsCompiled(openaxe::graph::BlockKind::kFilter)) {
      OPENAXE_EXPECT(std::strstr(buf.data(), "\"filter\"") != nullptr);
    }

    OpenAxeGraph* r = openaxe_graph_create();
    OPENAXE_EXPECT(openaxe_load_state(r, buf.data()) == OPENAXE_LOAD_STATE_OK);
    for (const KindWrite& w : writes) {
      if (blocks[w.block] < 0) continue;  // kind compiled out (#313)
      OPENAXE_EXPECT(GetParamBySymbol(r, blocks[w.block], w.symbol) == w.value);
    }
    openaxe_graph_destroy(r);
    openaxe_graph_destroy(g);
  }

  // ── Send/Return (issue #274) serialize and restore ──────────────────────
  // The routing kinds carry no params and no bypass, so their document is
  // just their kind string + position. The implicit Send->Return link is not
  // a cable, so it is not serialized - it re-derives from block presence on
  // load, and the reloaded pair must route signal exactly like the original.
  {
    OpenAxeGraph* g = openaxe_graph_create();
    const int32_t src = openaxe_add_block(g, OPENAXE_BLOCK_CAB, 0, 0);
    const int32_t send = openaxe_add_block(g, OPENAXE_BLOCK_SEND_1, 0, 1);
    const int32_t ret = openaxe_add_block(g, OPENAXE_BLOCK_RETURN_1, 0, 4);
    const int32_t sink = openaxe_add_block(g, OPENAXE_BLOCK_CAB, 0, 5);
    OPENAXE_EXPECT(openaxe_connect(g, kInRail, 0, src, 0) >= 0);
    OPENAXE_EXPECT(openaxe_connect(g, src, 0, send, 0) >= 0);
    OPENAXE_EXPECT(openaxe_connect(g, ret, 0, sink, 0) >= 0);
    OPENAXE_EXPECT(openaxe_connect(g, sink, 0, kOutRail, 0) >= 0);
    // No params, no bypass on the routing kinds.
    OPENAXE_EXPECT(openaxe_block_param_count(g, send) == 0);
    OPENAXE_EXPECT(openaxe_block_param_count(g, ret) == 0);

    const int32_t needed = openaxe_serialize_state(g, nullptr, 0);
    std::vector<char> buf(static_cast<size_t>(needed));
    openaxe_serialize_state(g, buf.data(), needed);
    OPENAXE_EXPECT(std::strstr(buf.data(), "\"send-1\"") != nullptr);
    OPENAXE_EXPECT(std::strstr(buf.data(), "\"return-1\"") != nullptr);

    OpenAxeGraph* r = openaxe_graph_create();
    OPENAXE_EXPECT(openaxe_load_state(r, buf.data()) == OPENAXE_LOAD_STATE_OK);
    // Restored pair still routes: a send into the reloaded graph travels the
    // implicit hop to the return. 0.5 in -> 0.5 out through the cab relays.
    const int32_t frames = 64;
    std::vector<float> input(static_cast<size_t>(frames), 0.5f);
    std::vector<float> output(static_cast<size_t>(frames), 0.0f);
    const float* in_ptrs[1] = {input.data()};
    float* out_ptrs[1] = {output.data()};
    openaxe_reset(r, 48000.0, frames);
    openaxe_process(r, in_ptrs, 1, out_ptrs, 1, frames);
    for (float sample : output) OPENAXE_EXPECT(std::fabs(sample - 0.5f) < 1e-6f);
    openaxe_graph_destroy(r);
    openaxe_graph_destroy(g);
  }

  // ── Spring reverb survives save/load round-trips (issue #392) ─────────
  // GetReverbAlgorithm + the rig_state string table each missed the Spring
  // case, so a Spring block saved as Hall and reloaded as Hall. The "drive"
  // symbol exists only on the spring tank (hall has 18 params, no drive),
  // so its presence on the reloaded block proves the algorithm survived.
  {
    OpenAxeGraph* g = openaxe_graph_create();
    const int32_t verb = openaxe_add_block(g, OPENAXE_BLOCK_REVERB, 0, 0);
    openaxe_set_reverb_algorithm(g, verb, OPENAXE_REVERB_SPRING);
    openaxe_set_reverb_control(g, verb, OPENAXE_REVERB_ROOM_SIZE, 0.6f);
    openaxe_set_reverb_control(g, verb, OPENAXE_REVERB_DRY_LEVEL, 25.0f);

    const int32_t needed = openaxe_serialize_state(g, nullptr, 0);
    std::vector<char> buf(static_cast<size_t>(needed));
    openaxe_serialize_state(g, buf.data(), needed);
    OPENAXE_EXPECT(std::strstr(buf.data(), "\"reverbAlgorithm\": \"spring\"") != nullptr);

    OpenAxeGraph* r = openaxe_graph_create();
    OPENAXE_EXPECT(openaxe_load_state(r, buf.data()) == OPENAXE_LOAD_STATE_OK);
    // Spring tank surface restored, not Hall's: drive present, 8 params.
    OPENAXE_EXPECT(!std::isnan(GetParamBySymbol(r, 0, "drive")));
    OPENAXE_EXPECT(openaxe_block_param_count(r, 0) ==
                   openaxe_block_param_count(g, verb));
    OPENAXE_EXPECT(GetParamBySymbol(r, 0, "dry_level") ==
                   GetParamBySymbol(g, verb, "dry_level"));

    // And a hand-written document naming "spring" loads as Spring too.
    OpenAxeGraph* h = openaxe_graph_create();
    OPENAXE_EXPECT(openaxe_load_state(h, R"({"schemaVersion": 1,
             "blocks": [{ "id": "v", "kind": "reverb", "row": 0, "col": 0,
                          "params": { "reverbAlgorithm": "spring" } }],
             "edges": [], "masterLevel": 1.0, "masterMuted": false})") ==
                   OPENAXE_LOAD_STATE_OK);
    OPENAXE_EXPECT(!std::isnan(GetParamBySymbol(h, 0, "drive")));
    openaxe_graph_destroy(h);
    openaxe_graph_destroy(r);
    openaxe_graph_destroy(g);
  }

  openaxe_graph_destroy(source);
  openaxe_graph_destroy(restored);
  openaxe_graph_destroy(clean);

  if (::openaxe::test::g_failures == 0) {
    std::printf("api_state_test passed\n");
    return 0;
  }
  std::printf("api_state_test FAILED (%d)\n", ::openaxe::test::g_failures);
  return 1;
}
