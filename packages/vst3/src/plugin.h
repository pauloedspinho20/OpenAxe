#pragma once

// Minimal iPlug2 plugin wrapping packages/core (issue #125).
// Construct/destroy NamStudioGraph, reset on sample-rate/block-size changes,
// pass audio through. No params/UI yet — later issues land there.

#include "IPlug_include_in_plug_hdr.h"

#include "nam_studio/api.h"

const int kNumPresets = 1;

class NamStudioPlugin final : public iplug::Plugin {
 public:
  explicit NamStudioPlugin(const iplug::InstanceInfo& info);
  ~NamStudioPlugin() override;

#if IPLUG_DSP
  void ProcessBlock(iplug::sample** inputs, iplug::sample** outputs, int nFrames) override;
  void OnReset() override;
#endif

 private:
  NamStudioGraph* graph_ = nullptr;
  double sample_rate_ = 48000.0;
  int max_block_size_ = 0;
};
