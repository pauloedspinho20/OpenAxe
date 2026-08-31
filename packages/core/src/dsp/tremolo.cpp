#include "openaxe/dsp/tremolo.h"

#include <algorithm>
#include <cmath>

#include "internal/biquad.h"

namespace openaxe::dsp {

namespace {
constexpr int kRateParam = 0;
constexpr int kDepthParam = 1;
constexpr int kShapeParam = 2;
constexpr int kStereoParam = 3;
constexpr int kModeParam = 4;
constexpr int kParamCount = 5;

// Harmonic mode's split point, between a guitar's body and its bite.
constexpr float kCrossoverHz = 800.0f;

const Tremolo::ParamInfo kParamInfo[kParamCount] = {
#include "generated/tremolo_params.inc"
};

inline float ShapeValue(float phase, int shape){
  // phase 0..1
  switch(shape){
    case 1: { // triangle
      float t=phase*4;
      if(t<1) return t;
      if(t<3) return 2-t;
      return t-4;
    }
    case 2: { // square with slight slew 2%
      const float slew=0.02f;
      if(phase < slew) return -1 + (phase/slew)*2;
      if(phase < 0.5f) return 1;
      if(phase < 0.5f+slew) return 1 - ((phase-0.5f)/slew)*2;
      return -1;
    }
    default: // sine
      return std::sin(phase*6.28318530718f);
  }
}

} // namespace

struct Tremolo::Impl {
  float rate=4.0f;
  float depth=0.5f;
  int shape=0;
  int stereo=1; // default stereo per prior Configure true
  int mode=0; // 0 normal,1 harmonic
  float sr = 48000;
  float phase = 0;
  // Harmonic mode's band split. One lowpass per channel; the high band is the
  // remainder (input - low), which is what makes the split *complementary*:
  // low + high is identically the input, so with no modulation applied the
  // mode is transparent.
  //
  // It used to be a separate highpass at the same cutoff and Q, and that
  // cancelled. A second-order lowpass and highpass sharing a cutoff are 180
  // degrees apart at that frequency - H_lp(jw0) = -jQ and H_hp(jw0) = +jQ for
  // any Q - so their sum is exactly zero there. Measured, the effect was a
  // 112dB null at 800Hz with a wide skirt (-8.4dB at 600Hz, -10.4dB at 1kHz)
  // present even at depth 0, i.e. harmonic mode notched a hole in the middle
  // of the guitar's fundamental range whether or not it was doing anything.
  // This is why real crossovers either invert one band or use fourth-order
  // sections; deriving the high band by subtraction sidesteps the question.
  internal::Biquad lpL, lpR;

  void ResetFilters(){
    lpL.Reset(); lpR.Reset();
    lpL.SetLowpass(kCrossoverHz, 0.707f, sr);
    lpR.SetLowpass(kCrossoverHz, 0.707f, sr);
  }
};

Tremolo::Tremolo(): impl_(std::make_unique<Impl>()){}
Tremolo::~Tremolo()=default;

void Tremolo::Reset(double sample_rate){
  impl_->sr = static_cast<float>(sample_rate);
  impl_->phase=0;
  impl_->ResetFilters();
}

void Tremolo::Process(const float* const* input, float* const* output, int num_frames){
  const float sr = impl_->sr;
  const float rate = impl_->rate;
  const float depth = impl_->depth;
  const int shape = impl_->shape;
  const int stereo = impl_->stereo;
  const int mode = impl_->mode;
  float phase = impl_->phase;
  float inc = rate / sr;

  // Harmonic-mode crossover filters are (re)seeded on Reset with the current
  // sample rate; nothing to do per block.

  for (int i = 0; i < num_frames; ++i) {
    float base_phase = phase;
    float phaseR = stereo ? std::fmod(base_phase+0.5f,1.0f) : base_phase;
    float modL = ShapeValue(base_phase, shape);
    float modR = ShapeValue(phaseR, shape);
    float gainL = 1.0f - depth * (1.0f - modL) * 0.5f;
    float gainR = 1.0f - depth * (1.0f - modR) * 0.5f;

    if(mode==0){
      output[0][i]= input[0][i]*gainL;
      output[1][i]= input[1][i]*gainR;
    } else {
      // Harmonic: split each channel, then modulate the two bands in opposite
      // phase, so the tone sweeps between dark and bright instead of the whole
      // signal getting quieter. invGain is gain(-mod), so the two are mirror
      // images and their sum is the constant (2 - depth) at every phase.
      const float inL = input[0][i];
      const float inR = input[1][i];
      const float lowL = impl_->lpL.Process(inL);
      const float lowR = impl_->lpR.Process(inR);
      const float highL = inL - lowL;
      const float highR = inR - lowR;
      const float invGainL = 1.0f - depth * (1.0f + modL) * 0.5f;
      const float invGainR = 1.0f - depth * (1.0f + modR) * 0.5f;
      output[0][i] = lowL * gainL + highL * invGainL;
      output[1][i] = lowR * gainR + highR * invGainR;
    }

    phase += inc;
    if(phase>=1.0f) phase-=1.0f;
  }
  impl_->phase=phase;
}

int Tremolo::ParamCount(){ return kParamCount; }
const Tremolo::ParamInfo& Tremolo::GetParamInfo(int index){ return kParamInfo[static_cast<size_t>(index)]; }
float Tremolo::GetParam(int index) const{
  switch(index){
    case kRateParam: return impl_->rate;
    case kDepthParam: return impl_->depth;
    case kShapeParam: return static_cast<float>(impl_->shape);
    case kStereoParam: return static_cast<float>(impl_->stereo);
    case kModeParam: return static_cast<float>(impl_->mode);
    default: return 0;
  }
}
void Tremolo::SetParam(int index,float value){
  switch(index){
    case kRateParam: impl_->rate = std::clamp(value,0.1f,20.0f); break;
    case kDepthParam: impl_->depth = std::clamp(value,0.0f,1.0f); break;
    case kShapeParam: impl_->shape = std::clamp((int)std::round(value),0,2); break;
    case kStereoParam: impl_->stereo = value>=0.5f?1:0; break;
    case kModeParam: impl_->mode = value>=0.5f?1:0; break;
    default: break;
  }
}

} // namespace openaxe::dsp
