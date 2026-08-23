#include "plugin.h"

#include "IPlug_include_in_plug_src.h"

#include "config.h"

NamStudioPlugin::NamStudioPlugin(const iplug::InstanceInfo& info)
    : Plugin(info, MakeConfig(0, kNumPresets)) {
  graph_ = nam_studio_graph_create();
  // No params yet — issue #127 introduces the 302-entry slot map.

#if IPLUG_EDITOR
  mMakeGraphicsFunc = [&]() {
    return MakeGraphics(*this, PLUG_WIDTH, PLUG_HEIGHT, PLUG_FPS, GetScaleForScreen(PLUG_WIDTH, PLUG_HEIGHT));
  };
  mLayoutFunc = [&](iplug::igraphics::IGraphics* pGraphics) {
    pGraphics->AttachCornerResizer(iplug::igraphics::EUIResizerMode::Scale, false);
    pGraphics->AttachPanelBackground(iplug::COLOR_GRAY);
    const iplug::igraphics::IRECT b = pGraphics->GetBounds();
    pGraphics->AttachControl(new iplug::igraphics::ITextControl(b.GetMidVPadded(40), "NAM Studio (scaffold)", iplug::igraphics::IText(24)));
  };
#endif
}

NamStudioPlugin::~NamStudioPlugin() { nam_studio_graph_destroy(graph_); }

#if IPLUG_DSP
void NamStudioPlugin::OnReset() {
  sample_rate_ = GetSampleRate();
  max_block_size_ = GetBlockSize();
  // iPlug2 guarantees OnReset before first ProcessBlock and on SR/BS changes.
  nam_studio_reset(graph_, sample_rate_, max_block_size_);
}

void NamStudioPlugin::ProcessBlock(iplug::sample** inputs, iplug::sample** outputs, int nFrames) {
  // Pass-through until later issues wire the graph + params.
  // Keep engine's reset contract: if host hands a larger block than last reset, re-reset.
  if (nFrames > max_block_size_) {
    max_block_size_ = nFrames;
    nam_studio_reset(graph_, sample_rate_, max_block_size_);
  }
  const int nChansIn = NInChansConnected();
  const int nChansOut = NOutChansConnected();
  // Engine is stereo; adapt channel counts like AudioEngine::Process does.
  nam_studio_process(graph_, const_cast<const float**>(inputs), nChansIn, outputs, nChansOut, nFrames);
}
#endif
