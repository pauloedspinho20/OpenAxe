// CTest for asset loading — issue #129
// Guards (#69), type checks, in-memory preferred forms, model info surfacing,
// readable errors, last-dir memory. No dialog (headless).

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "../src/asset_loading.h"
#include "openaxe/api.h"

static int g_failures = 0;
#define CHECK(cond) do { if(!(cond)){ std::fprintf(stderr,"CHECK failed: %s (%s:%d)\n",#cond,__FILE__,__LINE__); ++g_failures; } } while(0)

namespace {

std::vector<uint8_t> MakeWavBytes(int sample_rate, const std::vector<float>& mono) {
  const int num_ch = 1;
  const int bits = 16;
  const int byte_rate = sample_rate * num_ch * bits/8;
  const int block_align = num_ch * bits/8;
  const int data_bytes = static_cast<int>(mono.size()) * 2;
  const int chunk_size = 36 + data_bytes;
  std::vector<uint8_t> b;
  b.reserve(44 + data_bytes);
  auto put_u32 = [&](uint32_t v){ b.push_back(v & 0xff); b.push_back((v>>8)&0xff); b.push_back((v>>16)&0xff); b.push_back((v>>24)&0xff); };
  auto put_u16 = [&](uint16_t v){ b.push_back(v & 0xff); b.push_back((v>>8)&0xff); };
  auto put_str = [&](const char* s){ for(int i=0;i<4;++i) b.push_back(s[i]); };
  put_str("RIFF"); put_u32(chunk_size); put_str("WAVE");
  put_str("fmt "); put_u32(16); put_u16(1); put_u16(num_ch); put_u32(sample_rate); put_u32(byte_rate); put_u16(block_align); put_u16(bits);
  put_str("data"); put_u32(data_bytes);
  for(float f: mono){ int16_t s = static_cast<int16_t>(std::clamp(f, -1.0f, 1.0f)*32767); put_u16(static_cast<uint16_t>(s)); }
  return b;
}

void TestSizeGuards() {
  OpenAxeGraph* g = openaxe_graph_create();
  const int32_t amp = openaxe_add_block(g, OPENAXE_BLOCK_AMP, 0,0);
  // Model: oversize via in-memory json size check (>32 MB) — use a string just over the limit but don't actually allocate 32MB fully if too heavy? 32MB is okay for test (allocate once)
  // Instead create a string view that would trigger size check without huge alloc by directly testing the guard threshold: create a string of kMax+1 via resize (32MB) — acceptable for one test
  // To keep CI light, we test the boundary via the file-path helper with a temp file of 32MB+1 disguised as small content + size check via file_size? But file_size guard also checks filesystem size, so we need a real file. Instead we test the in-memory guard directly with a string just over the limit using a smaller limit simulation:
  // The guard is simple `json.size() > kMaxNamModelBytes`, so we can just call with a 33MB string once.
  // For speed, allocate 33MB once then free.
  const size_t over = openaxe_vst3::assets::kMaxNamModelBytes + 1024;
  std::string big(over, 'x');
  std::string err;
  auto r = openaxe_vst3::assets::LoadNamModelFromJson(g, amp, big, &err);
  CHECK(r == openaxe_vst3::assets::LoadResult::TooLarge);
  CHECK(!err.empty());

  // IR: oversize via bytes
  std::vector<uint8_t> big_wav(openaxe_vst3::assets::kMaxIrWavBytes + 1024, 0);
  // Fill with WAV header so type guard wouldn't preempt, but size guard should win
  if(big_wav.size() >= 12){ std::memcpy(big_wav.data(), "RIFF",4); std::memcpy(big_wav.data()+8,"WAVE",4); }
  std::string err2;
  auto r2 = openaxe_vst3::assets::LoadIrWavFromBytes(g, amp, big_wav.data(), big_wav.size(), &err2);
  CHECK(r2 == openaxe_vst3::assets::LoadResult::TooLarge);
  CHECK(!err2.empty());

  openaxe_graph_destroy(g);
  std::printf("  size guards (32MB/8MB): ok\n");
}

void TestTypeGuards() {
  OpenAxeGraph* g = openaxe_graph_create();
  const int32_t cab = openaxe_add_block(g, OPENAXE_BLOCK_CAB, 0,0);
  std::string err;
  // Not WAV
  std::vector<uint8_t> not_wav = {'h','e','l','l','o'};
  auto r = openaxe_vst3::assets::LoadIrWavFromBytes(g, cab, not_wav.data(), not_wav.size(), &err);
  CHECK(r == openaxe_vst3::assets::LoadResult::NotWav);
  CHECK(!err.empty());
  // Valid header but empty data should be invalid format (core decode fails)
  std::vector<float> tiny(64, 0.1f);
  auto wav = MakeWavBytes(48000, tiny);
  // Corrupt to non-WAVE
  wav[9] = 'X';
  std::string err3;
  auto r3 = openaxe_vst3::assets::LoadIrWavFromBytes(g, cab, wav.data(), wav.size(), &err3);
  CHECK(r3 == openaxe_vst3::assets::LoadResult::NotWav);

  openaxe_graph_destroy(g);
  std::printf("  type guards (RIFF/WAVE, not WAV): ok\n");
}

void TestInvalidModelFormat() {
  OpenAxeGraph* g = openaxe_graph_create();
  const int32_t amp = openaxe_add_block(g, OPENAXE_BLOCK_AMP, 0,0);
  std::string err;
  auto r = openaxe_vst3::assets::LoadNamModelFromJson(g, amp, std::string(R"({"not":"a model"})"), &err);
  CHECK(r == openaxe_vst3::assets::LoadResult::InvalidFormat);
  CHECK(!err.empty());
  // Unknown block
  std::string err2;
  auto r2 = openaxe_vst3::assets::LoadNamModelFromJson(g, 999, std::string("{}"), &err2);
  CHECK(r2 == openaxe_vst3::assets::LoadResult::UnknownBlock);
  openaxe_graph_destroy(g);
  std::printf("  invalid model format + unknown block: ok\n");
}

void TestValidIrLoadAndInfo() {
  OpenAxeGraph* g = openaxe_graph_create();
  const int32_t cab = openaxe_add_block(g, OPENAXE_BLOCK_CAB, 0,0);
  openaxe_reset(g, 48000.0, 512);
  std::vector<float> mono(256);
  for(size_t i=0;i<mono.size();++i) mono[i] = std::sin(float(i)*0.2f)*0.5f;
  auto wav = MakeWavBytes(48000, mono);
  std::string err;
  auto r = openaxe_vst3::assets::LoadIrWavFromBytes(g, cab, wav.data(), wav.size(), &err);
  CHECK(r == openaxe_vst3::assets::LoadResult::Ok);
  CHECK(err.empty());
  auto len = openaxe_vst3::assets::GetIrLength(g, cab);
  CHECK(len.has_value() && *len > 0);
  // Model info should be absent for cab
  auto mi = openaxe_vst3::assets::GetModelInfo(g, cab);
  CHECK(!mi.has_value());
  // Amp without model also none
  const int32_t amp = openaxe_add_block(g, OPENAXE_BLOCK_AMP, 0,1);
  auto mi2 = openaxe_vst3::assets::GetModelInfo(g, amp);
  CHECK(!mi2.has_value());

  // After IR, process should not NaN
  float in[64]; for(int i=0;i<64;++i) in[i]=0.1f;
  float out[64]={};
  const float* ip[1]={in}; float* op[1]={out};
  openaxe_process(g, ip,1,op,1,64);
  for(int i=0;i<64;++i) CHECK(std::isfinite(out[i]));

  openaxe_graph_destroy(g);
  std::printf("  valid IR load + GetIrLength + GetModelInfo: ok\n");
}

void TestFilePathGuards() {
  OpenAxeGraph* g = openaxe_graph_create();
  const int32_t amp = openaxe_add_block(g, OPENAXE_BLOCK_AMP, 0,0);
  std::string err;
  auto r = openaxe_vst3::assets::LoadNamModelFromPath(g, amp, "/no/such/file.nam", &err);
  CHECK(r == openaxe_vst3::assets::LoadResult::FileNotFound);
  CHECK(!err.empty());
  auto r2 = openaxe_vst3::assets::LoadIrWavFromPath(g, amp, "/no/such/file.wav", &err);
  CHECK(r2 == openaxe_vst3::assets::LoadResult::FileNotFound);

  // Oversize file via temp file (8MB+1 for IR)
  // Platform temp dir — see the note in state_test.cpp; on Windows the write
  // to "/tmp/..." failed, so the file was never oversize and the TooLarge
  // guard was never reached.
  const std::string tmp =
      (std::filesystem::temp_directory_path() / "openaxe_oversize_test.wav").string();
  {
    std::ofstream out(tmp, std::ios::binary);
    std::vector<char> chunk(1024*1024, 'x');
    // Write 9MB
    for(int i=0;i<9;++i) out.write(chunk.data(), chunk.size());
  }
  std::string err3;
  auto r3 = openaxe_vst3::assets::LoadIrWavFromPath(g, amp, tmp, &err3);
  CHECK(r3 == openaxe_vst3::assets::LoadResult::TooLarge);
  std::filesystem::remove(tmp);
  openaxe_graph_destroy(g);
  std::printf("  file-not-found + oversize via path: ok\n");
}

void TestLastDirMemory() {
  openaxe_vst3::assets::SetLastNamDirectory("/tmp/foo");
  openaxe_vst3::assets::SetLastIrDirectory("/tmp/bar");
  CHECK(openaxe_vst3::assets::GetLastNamDirectory() == "/tmp/foo");
  CHECK(openaxe_vst3::assets::GetLastIrDirectory() == "/tmp/bar");
  std::printf("  last-dir memory: ok\n");
}

} // namespace


// ── Base64 (issue #300 E4) ────────────────────────────────────────────
// Cab IRs reach the plugin as base64 in the bridge payload, so a decoder that
// silently truncates on bad input would hand the core a half-formed WAV.
static void TestDecodeBase64() {
  using openaxe_vst3::assets::DecodeBase64;

  auto str = [](const std::vector<uint8_t>& v) {
    return std::string(v.begin(), v.end());
  };

  // RFC 4648 vectors, including every padding case.
  CHECK(str(DecodeBase64("")) == "");
  CHECK(str(DecodeBase64("Zg==")) == "f");
  CHECK(str(DecodeBase64("Zm8=")) == "fo");
  CHECK(str(DecodeBase64("Zm9v")) == "foo");
  CHECK(str(DecodeBase64("Zm9vYg==")) == "foob");
  CHECK(str(DecodeBase64("Zm9vYmE=")) == "fooba");
  CHECK(str(DecodeBase64("Zm9vYmFy")) == "foobar");

  // Whitespace is tolerated (JSON payloads and hand-wrapped base64 both have it).
  CHECK(str(DecodeBase64("Zm9v\nYmFy")) == "foobar");
  CHECK(str(DecodeBase64("Zm9v YmFy")) == "foobar");

  // Invalid input is rejected outright, not truncated to what parsed so far.
  CHECK(DecodeBase64("Zm9v!!!!").empty());
  CHECK(DecodeBase64("****").empty());
  // URL-safe alphabet is deliberately NOT accepted — the UI sends standard.
  CHECK(DecodeBase64("a-b_").empty());

  // A real RIFF/WAVE header survives the round trip, which is what the bridge
  // sanity-checks before handing bytes to the core.
  const std::string riff_b64 = "UklGRiQAAABXQVZF";  // "RIFF$\0\0\0WAVE"
  const auto riff = DecodeBase64(riff_b64);
  CHECK(riff.size() >= 12);
  CHECK(std::memcmp(riff.data(), "RIFF", 4) == 0);
  CHECK(std::memcmp(riff.data() + 8, "WAVE", 4) == 0);
}

int main(){
  TestDecodeBase64();
  TestSizeGuards();
  TestTypeGuards();
  TestInvalidModelFormat();
  TestValidIrLoadAndInfo();
  TestFilePathGuards();
  TestLastDirMemory();
  if(g_failures){ std::fprintf(stderr,"%d failure(s)\n", g_failures); return 1; }
  std::printf("asset_loading_test: all checks passed\n");
  return 0;
}
