// Issue #120's round-trip proof: a rig carrying a real NAM capture and a real
// IR, serialized with embed_assets=1, must restore bit-identically into a
// fresh graph whose source files are gone - plus the fallback ladder
// (payload -> path -> missing list), the #69 size ceilings on embedded
// payloads, and known-answer tests for the hash/base64 helpers the wire
// format leans on.

#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "openaxe/api.h"
#include "openaxe/dsp/wav.h"
#include "openaxe/engine.h"
#include "serialization/base64.h"
#include "serialization/sha256.h"
#include "test_harness.h"

namespace fs = std::filesystem;
using openaxe::state::Base64Decode;
using openaxe::state::Base64Encode;
using openaxe::state::Sha256Hex;

namespace {

constexpr int32_t kInRail = OPENAXE_IN_RAIL;
constexpr int32_t kOutRail = OPENAXE_OUT_RAIL;
constexpr int32_t kFrames = 256;
constexpr int kIrFrames = 512;

std::string ReadFileText(const std::string& path) {
  std::ifstream ifs(path, std::ios::binary);
  if (!ifs.good()) return {};
  return std::string((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
}

// A short synthetic cab IR: a decaying resonance. Encoded as float32 WAV so
// openaxe_load_ir_wav decodes exactly these samples back (no resampling -
// same rate as the graph).
std::vector<uint8_t> MakeIrWav() {
  std::vector<float> samples;
  samples.reserve(kIrFrames);
  for (int i = 0; i < kIrFrames; ++i) {
    samples.push_back(0.5f * std::exp(static_cast<float>(i) / -64.0f) *
                      std::sin(static_cast<float>(i) * 0.31f));
  }
  return openaxe::dsp::EncodeWavF32(samples, 48000.0);
}

// The rig under test: IN -> amp(0,0) -> cab(0,1) -> OUT. Small on purpose -
// the assertion that matters is sample identity of the whole chain.
void BuildRig(OpenAxeGraph* g) {
  const int32_t amp = openaxe_add_block(g, OPENAXE_BLOCK_AMP, 0, 0);
  const int32_t cab = openaxe_add_block(g, OPENAXE_BLOCK_CAB, 0, 1);
  OPENAXE_EXPECT(amp == 0);
  OPENAXE_EXPECT(cab == 1);
  OPENAXE_EXPECT(openaxe_connect(g, kInRail, 0, amp, 0) >= 0);
  OPENAXE_EXPECT(openaxe_connect(g, amp, 0, cab, 0) >= 0);
  OPENAXE_EXPECT(openaxe_connect(g, cab, 0, kOutRail, 0) >= 0);
}

void LoadAssets(OpenAxeGraph* g, const char* model_json_or_path, bool from_path,
                const std::vector<uint8_t>& ir_wav) {
  if (from_path) {
    OPENAXE_EXPECT(openaxe_load_nam_model(g, 0, model_json_or_path) == OPENAXE_LOAD_OK);
  } else {
    OPENAXE_EXPECT(openaxe_load_nam_model_json(g, 0, model_json_or_path) == OPENAXE_LOAD_OK);
  }
  OPENAXE_EXPECT(openaxe_load_ir_wav(g, 1, ir_wav.data(), static_cast<int32_t>(ir_wav.size())) ==
             kIrFrames);
}

// Runs the test signal through `g` and returns the stereo output.
void Render(OpenAxeGraph* g, std::vector<float>& out_l, std::vector<float>& out_r) {
  std::vector<float> in_l(kFrames);
  std::vector<float> in_r(kFrames);
  for (int32_t i = 0; i < kFrames; ++i) {
    in_l[static_cast<size_t>(i)] = 0.25f * std::sin(static_cast<float>(i) * 0.05f);
    in_r[static_cast<size_t>(i)] = 0.2f * std::cos(static_cast<float>(i) * 0.03f);
  }
  out_l.assign(static_cast<size_t>(kFrames), 0.0f);
  out_r.assign(static_cast<size_t>(kFrames), 0.0f);
  openaxe_reset(g, 48000.0, kFrames);
  openaxe_set_master_muted(g, 0);
  const float* in_ptrs[2] = {in_l.data(), in_r.data()};
  float* out_ptrs[2] = {out_l.data(), out_r.data()};
  for (int block = 0; block < 4; ++block) {
    openaxe_process(g, in_ptrs, 2, out_ptrs, 2, kFrames);
  }
}

bool SameSamples(const std::vector<float>& a, const std::vector<float>& b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); ++i) {
    // Bit-exact: the whole point of embedding is that nothing in the chain
    // changes - not even one ULP.
    if (a[i] != b[i]) {
      std::fprintf(stderr, "  (audio divergence at %zu: %.9g vs %.9g)\n", i,
                   static_cast<double>(a[i]), static_cast<double>(b[i]));
      return false;
    }
  }
  return true;
}

std::string Serialize(OpenAxeGraph* g, int embed) {
  const int32_t needed = openaxe_serialize_state_ex(g, embed, nullptr, 0);
  OPENAXE_EXPECT(needed > 16);
  std::vector<char> buf(static_cast<size_t>(needed));
  OPENAXE_EXPECT(openaxe_serialize_state_ex(g, embed, buf.data(), needed) == needed);
  return std::string(buf.data());
}

}  // namespace

int main() {
  // ── Hash + base64 known-answer tests ────────────────────────────────────
  // FIPS 180-4 vectors, including the 56-byte one that forces SHA-256's
  // two-block padding path.
  OPENAXE_EXPECT(Sha256Hex(nullptr, 0) ==
             "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  OPENAXE_EXPECT(Sha256Hex(reinterpret_cast<const uint8_t*>("abc"), 3) ==
             "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const std::string long_input =
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";  // 56 bytes
  OPENAXE_EXPECT(Sha256Hex(reinterpret_cast<const uint8_t*>(long_input.data()), long_input.size()) ==
             "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  {
    const std::vector<uint8_t> blob(3u * 1024u * 1024u + 17u, 0x5Au);
    const auto h1 = Sha256Hex(blob.data(), blob.size());
    const auto h2 = Sha256Hex(blob.data(), blob.size());
    OPENAXE_EXPECT(h1 == h2 && h1.size() == 64);
    const auto h3 = Sha256Hex(blob.data(), blob.size() - 1);
    OPENAXE_EXPECT(h3 != h1);
  }

  // RFC 4648 vectors for base64, round-trips across tail sizes, rejection of
  // malformed input, and the pre-allocation output cap.
  {
    const auto enc = [](const char* s) {
      return Base64Encode(reinterpret_cast<const uint8_t*>(s), std::strlen(s));
    };
    OPENAXE_EXPECT(enc("") == "");
    OPENAXE_EXPECT(enc("f") == "Zg==");
    OPENAXE_EXPECT(enc("fo") == "Zm8=");
    OPENAXE_EXPECT(enc("foo") == "Zm9v");
    OPENAXE_EXPECT(enc("foob") == "Zm9vYg==");
    OPENAXE_EXPECT(enc("fooba") == "Zm9vYmE=");
    OPENAXE_EXPECT(enc("foobar") == "Zm9vYmFy");

    std::vector<uint8_t> decoded;
    for (const size_t size : {size_t{0}, size_t{1}, size_t{2}, size_t{3}, size_t{7}, size_t{64},
                              size_t{4096}}) {
      std::vector<uint8_t> data(size);
      for (size_t i = 0; i < size; ++i) data[i] = static_cast<uint8_t>(i * 37 + 11);
      const std::string text = Base64Encode(data.data(), data.size());
      OPENAXE_EXPECT(Base64Decode(text.data(), text.size(), 1 << 20, decoded));
      OPENAXE_EXPECT(decoded == data);
    }

    std::vector<uint8_t> sink;
    OPENAXE_EXPECT(!Base64Decode("A", 1, 1024, sink));      // not a multiple of 4
    OPENAXE_EXPECT(!Base64Decode("@@@@", 4, 1024, sink));   // outside the alphabet
    OPENAXE_EXPECT(!Base64Decode("A=B=", 4, 1024, sink));   // padding mid-group
    OPENAXE_EXPECT(!Base64Decode("====", 4, 1024, sink));   // nothing but padding
    const std::vector<uint8_t> kilo(1000, 1);
    const std::string big = Base64Encode(kilo.data(), kilo.size());
    OPENAXE_EXPECT(!Base64Decode(big.data(), big.size(), 999, sink));  // cap, before allocating
    OPENAXE_EXPECT(sink.empty());  // a failed decode must not touch the output
  }

  // ── The rig: real capture via JSON + real IR bytes ──────────────────────
  const std::string model_json =
      ReadFileText(std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/lstm.nam");
  OPENAXE_EXPECT(!model_json.empty());

  OpenAxeGraph* source = openaxe_graph_create();
  BuildRig(source);  // amp=0, cab=1
  const auto ir_wav = MakeIrWav();
  LoadAssets(source, model_json.c_str(), /*from_path=*/false, ir_wav);

  std::vector<float> ref_l;
  std::vector<float> ref_r;
  Render(source, ref_l, ref_r);
  bool ref_has_signal = false;
  for (int32_t i = 0; i < kFrames && !ref_has_signal; ++i) {
    if (ref_l[static_cast<size_t>(i)] != 0.0f || ref_r[static_cast<size_t>(i)] != 0.0f) {
      ref_has_signal = true;
    }
  }
  OPENAXE_EXPECT(ref_has_signal);  // silence would make "sample-identical" vacuous

  // ── Serialize with embedding ────────────────────────────────────────────
  const std::string embedded_doc = Serialize(source, 1);
  OPENAXE_EXPECT(embedded_doc.find("\"model\"") != std::string::npos);
  OPENAXE_EXPECT(embedded_doc.find("\"ir\"") != std::string::npos);
  OPENAXE_EXPECT(embedded_doc.find("\"payload\"") != std::string::npos);
  OPENAXE_EXPECT(embedded_doc.find("\"hash\"") != std::string::npos);

  // ── Destroy the source; restore into a fresh graph ──────────────────────
  // The sources are already "deleted": the capture exists only in this
  // process's memory, the IR never had a file at all. Restoration must come
  // entirely from the document.
  openaxe_graph_destroy(source);
  OpenAxeGraph* restored = openaxe_graph_create();
  OPENAXE_EXPECT(openaxe_load_state(restored, embedded_doc.c_str()) == OPENAXE_LOAD_STATE_OK);
  OPENAXE_EXPECT(openaxe_state_missing_asset_count(restored) == 0);
  OPENAXE_EXPECT(openaxe_block_has_model(restored, 0) == 1);
  OPENAXE_EXPECT(openaxe_block_ir_length(restored, 1) == kIrFrames);
  OPENAXE_EXPECT(openaxe_state_missing_asset(restored, 0) == nullptr);  // out of range

  // The issue's done-when: audio.
  std::vector<float> got_l;
  std::vector<float> got_r;
  Render(restored, got_l, got_r);
  OPENAXE_EXPECT(SameSamples(ref_l, got_l));
  OPENAXE_EXPECT(SameSamples(ref_r, got_r));

  // Re-serializing the restored rig must reproduce the document byte for
  // byte - the payload-restored blocks kept the document's name/path metadata.
  OPENAXE_EXPECT(Serialize(restored, 1) == embedded_doc);
  openaxe_graph_destroy(restored);

  // ── Without embedding: references only, and the missing list when they dangle ──
  {
    OpenAxeGraph* g = openaxe_graph_create();
    BuildRig(g);
    LoadAssets(g, model_json.c_str(), /*from_path=*/false, ir_wav);
    const std::string lean_doc = Serialize(g, 0);
    openaxe_graph_destroy(g);

    // References are always written; the payload is not.
    OPENAXE_EXPECT(lean_doc.find("\"payload\"") == std::string::npos);
    OPENAXE_EXPECT(lean_doc.find("\"hash\"") != std::string::npos);

    // Neither reference can resolve here: the model was loaded from JSON (no
    // path) and the IR never had a file. Both blocks stay empty; both assets
    // are reported by name. Partial-failure tolerance applies - the blocks
    // themselves restored fine.
    OpenAxeGraph* fresh = openaxe_graph_create();
    OPENAXE_EXPECT(openaxe_load_state(fresh, lean_doc.c_str()) == OPENAXE_LOAD_STATE_OK);
    OPENAXE_EXPECT(openaxe_state_missing_asset_count(fresh) == 2);
    OPENAXE_EXPECT(std::string(openaxe_state_missing_asset(fresh, 0)) == "(unnamed model)");
    OPENAXE_EXPECT(std::string(openaxe_state_missing_asset(fresh, 1)) == "(unnamed IR)");
    OPENAXE_EXPECT(openaxe_block_has_model(fresh, 0) == 0);   // left empty...
    OPENAXE_EXPECT(openaxe_block_ir_length(fresh, 1) == 0);   // ...not aborted
    OPENAXE_EXPECT(openaxe_is_bypassed(fresh, 1) == 0);
    openaxe_graph_destroy(fresh);
  }

  // ── Path relinking, model side: embed=0 restores while the file exists ──
  const auto temp_dir = fs::temp_directory_path() /
                        ("nam_state_assets_test_" +
                         std::to_string(std::chrono::steady_clock::now()
                                            .time_since_epoch()
                                            .count()) + "_" + std::to_string(std::rand()));
  std::error_code fs_ec;
  fs::create_directories(temp_dir, fs_ec);
  const auto model_path = temp_dir / "bench_amp.nam";
  {
    std::ofstream ofs(model_path, std::ios::binary);
    ofs << model_json;
    OPENAXE_EXPECT(ofs.good());
  }

  OpenAxeGraph* from_path = openaxe_graph_create();
  openaxe_add_block(from_path, OPENAXE_BLOCK_AMP, 0, 0);
  openaxe_connect(from_path, kInRail, 0, 0, 0);
  openaxe_connect(from_path, 0, 0, kOutRail, 0);
  OPENAXE_EXPECT(openaxe_load_nam_model(from_path, 0, model_path.string().c_str()) ==
             OPENAXE_LOAD_OK);
  std::vector<float> amp_ref_l;
  std::vector<float> amp_ref_r;
  Render(from_path, amp_ref_l, amp_ref_r);

  // A path-loaded capture reports its file's stem as its display name. The
  // document is written WITHOUT embedding so restoration below has to go
  // through the recorded path.
  const std::string lean_amp_doc = Serialize(from_path, 0);
  OPENAXE_EXPECT(lean_amp_doc.find("\"name\": \"bench_amp\"") != std::string::npos);
  OPENAXE_EXPECT(lean_amp_doc.find(model_path.string()) != std::string::npos);

  {
    // File still present: embed=0 restores through the recorded path.
    OpenAxeGraph* relinked = openaxe_graph_create();
    OPENAXE_EXPECT(openaxe_load_state(relinked, lean_amp_doc.c_str()) ==
               OPENAXE_LOAD_STATE_OK);
    OPENAXE_EXPECT(openaxe_state_missing_asset_count(relinked) == 0);
    OPENAXE_EXPECT(openaxe_block_has_model(relinked, 0) == 1);
    std::vector<float> rl;
    std::vector<float> rr;
    Render(relinked, rl, rr);
    OPENAXE_EXPECT(SameSamples(amp_ref_l, rl));
    OPENAXE_EXPECT(SameSamples(amp_ref_r, rr));
    openaxe_graph_destroy(relinked);
  }

  // File deleted: the block stays empty and the asset is reported by name.
  fs::remove(model_path, fs_ec);
  {
    OpenAxeGraph* after_delete = openaxe_graph_create();
    OPENAXE_EXPECT(openaxe_load_state(after_delete, lean_amp_doc.c_str()) ==
               OPENAXE_LOAD_STATE_OK);
    OPENAXE_EXPECT(openaxe_state_missing_asset_count(after_delete) == 1);
    OPENAXE_EXPECT(std::string(openaxe_state_missing_asset(after_delete, 0)) == "bench_amp");
    OPENAXE_EXPECT(openaxe_block_has_model(after_delete, 0) == 0);
    OPENAXE_EXPECT(openaxe_state_missing_asset(after_delete, 1) == nullptr);
    openaxe_graph_destroy(after_delete);

    // A payload that fails to load must fall back to the recorded path before
    // giving up. Rewrite the file, craft a document whose payload is garbage
    // but whose path points at it.
    std::ofstream ofs(model_path, std::ios::binary);
    ofs << model_json;
    ofs.close();
    OPENAXE_EXPECT(fs::exists(model_path));
    std::string crafted = R"({"schemaVersion": 1,
      "blocks": [ { "id": "a", "kind": "amp", "row": 0, "col": 0, "params": {},
                    "model": { "name": "", "hash": "", "path": ")" +
                          model_path.string() + R"(", "payload": "@@@@ bad @@@@" } } ],
      "edges": [
        { "from": { "blockId": "-1", "port": 0 }, "to": { "blockId": "a", "port": 0 } },
        { "from": { "blockId": "a", "port": 0 }, "to": { "blockId": "-2", "port": 0 } }
      ],
      "masterLevel": 1.0, "masterMuted": false })";
    OpenAxeGraph* fallback = openaxe_graph_create();
    OPENAXE_EXPECT(openaxe_load_state(fallback, crafted.c_str()) == OPENAXE_LOAD_STATE_OK);
    OPENAXE_EXPECT(openaxe_state_missing_asset_count(fallback) == 0);
    OPENAXE_EXPECT(openaxe_block_has_model(fallback, 0) == 1);
    std::vector<float> fl;
    std::vector<float> fr;
    Render(fallback, fl, fr);
    OPENAXE_EXPECT(SameSamples(amp_ref_l, fl));  // same capture -> same audio
    OPENAXE_EXPECT(SameSamples(amp_ref_r, fr));
    openaxe_graph_destroy(fallback);
  }

  // ── Path relinking, IR side: a hand-built document with an ir.path ──────
  const auto ir_path = temp_dir / "bench_cab.wav";
  {
    std::ofstream ofs(ir_path, std::ios::binary);
    ofs.write(reinterpret_cast<const char*>(ir_wav.data()),
              static_cast<std::streamsize>(ir_wav.size()));
    OPENAXE_EXPECT(ofs.good());
  }
  std::string ir_doc = R"({"schemaVersion": 1,
      "blocks": [ { "id": "c", "kind": "cab", "row": 0, "col": 0, "params": {},
                    "ir": { "name": "bench", "hash": "aa", "path": ")" +
                       ir_path.string() + R"(", "payload": "" } } ],
      "edges": [], "masterLevel": 1.0, "masterMuted": false })";
  {
    OpenAxeGraph* g = openaxe_graph_create();
    OPENAXE_EXPECT(openaxe_load_state(g, ir_doc.c_str()) == OPENAXE_LOAD_STATE_OK);
    OPENAXE_EXPECT(openaxe_state_missing_asset_count(g) == 0);
    OPENAXE_EXPECT(openaxe_block_ir_length(g, 0) == kIrFrames);
    openaxe_graph_destroy(g);

    fs::remove(ir_path, fs_ec);
    OpenAxeGraph* after_delete = openaxe_graph_create();
    OPENAXE_EXPECT(openaxe_load_state(after_delete, ir_doc.c_str()) == OPENAXE_LOAD_STATE_OK);
    OPENAXE_EXPECT(openaxe_state_missing_asset_count(after_delete) == 1);
    OPENAXE_EXPECT(std::string(openaxe_state_missing_asset(after_delete, 0)) == "bench");
    OPENAXE_EXPECT(openaxe_block_ir_length(after_delete, 0) == 0);
    openaxe_graph_destroy(after_delete);
  }

  // ── Size ceilings (#69): an embedded payload is untrusted project input ──
  {
    // An embedded IR whose decoded size exceeds kMaxIrBytes is refused before
    // allocating; the load itself still succeeds and reports the miss.
    // 'A' decodes to zero bytes: this string would decode to ~9 MB > 8 MiB.
    std::string oversized =
        R"({"schemaVersion": 1,
          "blocks": [
            { "id": "gate", "kind": "noise-gate", "row": 0, "col": 0,
              "params": { "threshold": 0.3 } },
            { "id": "c", "kind": "cab", "row": 0, "col": 1, "params": {},
              "ir": { "name": "huge", "hash": "", "path": "", "payload": ")" +
                   std::string(12000000, 'A') + R"(" } }
          ],
          "edges": [], "masterLevel": 1.0, "masterMuted": false })";
    OpenAxeGraph* g = openaxe_graph_create();
    OPENAXE_EXPECT(openaxe_load_state(g, oversized.c_str()) == OPENAXE_LOAD_STATE_OK);
    OPENAXE_EXPECT(openaxe_state_missing_asset_count(g) == 1);
    OPENAXE_EXPECT(std::string(openaxe_state_missing_asset(g, 0)) == "huge");
    OPENAXE_EXPECT(openaxe_block_ir_length(g, 1) == 0);
    // The gate next door restored regardless.
    bool threshold_found = false;
    const int32_t count = openaxe_block_param_count(g, 0);
    for (int32_t i = 0; i < count && !threshold_found; ++i) {
      const char* symbol = nullptr;
      if (openaxe_block_param_info(g, 0, i, nullptr, &symbol, nullptr, nullptr, nullptr) &&
          std::strcmp(symbol, "threshold") == 0) {
        OPENAXE_EXPECT(openaxe_get_param(g, 0, i) == 0.3f);
        threshold_found = true;
      }
    }
    OPENAXE_EXPECT(threshold_found);
    openaxe_graph_destroy(g);

    // Same ceiling enforced directly on the engine entry point.
    OpenAxeGraph* g2 = openaxe_graph_create();
    openaxe_add_block(g2, OPENAXE_BLOCK_AMP, 0, 0);
    const std::string huge_json(openaxe::engine::kMaxModelBytes + 1, 'x');
    OPENAXE_EXPECT(openaxe_load_nam_model_json(g2, 0, huge_json.c_str()) ==
               OPENAXE_LOAD_INVALID_FORMAT);
    openaxe_graph_destroy(g2);
  }

  // ── Legacy documents without any model/ir objects load unchanged ─────────
  {
    const char* legacy = R"({"schemaVersion": 1,
      "blocks": [ { "id": "a", "kind": "amp", "row": 0, "col": 0, "params": {} } ],
      "edges": [], "masterLevel": 1.0, "masterMuted": false })";
    OpenAxeGraph* g = openaxe_graph_create();
    OPENAXE_EXPECT(openaxe_load_state(g, legacy) == OPENAXE_LOAD_STATE_OK);
    OPENAXE_EXPECT(openaxe_state_missing_asset_count(g) == 0);
    openaxe_graph_destroy(g);
  }

  fs::remove_all(temp_dir, fs_ec);

  openaxe_graph_destroy(from_path);

  if (::openaxe::test::g_failures == 0) {
    std::printf("api_state_assets_test passed\n");
    return 0;
  }
  std::printf("api_state_assets_test FAILED (%d)\n", ::openaxe::test::g_failures);
  return 1;
}
