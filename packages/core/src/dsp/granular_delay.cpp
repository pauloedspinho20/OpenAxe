#include "openaxe/dsp/granular_delay.h"

#include <algorithm>
#include <cmath>
#include <vector>
#include <random>

#include "internal/delay_line.h"
#include "internal/lagrange3.h"
#include "internal/variable_delay.h"

namespace openaxe::dsp {

namespace {
constexpr int kTimeParam=0;
constexpr int kGrainSizeParam=1;
constexpr int kDensityParam=2;
constexpr int kPitchParam=3;
constexpr int kJitterParam=4;
constexpr int kFeedbackParam=5;
constexpr int kSpreadParam=6;
constexpr int kCharacterParam=7;
constexpr int kFreezeParam=8;
constexpr int kParamCount=9;
const GranularDelay::ParamInfo kParamInfo[kParamCount]={
#include "generated/granular_delay_params.inc"
};

// simple one-pole lowpass for character
struct OnePoleLP{
  float y=0;
  float Process(float x,float coeff){ y += coeff*(x - y); return y; }
  void Reset(){ y=0; }
};

} // namespace

struct GranularDelay::Impl {
  float time_ms=400;
  float grain_size_ms=80;
  float density=8;
  float pitch=0;
  float jitter=0.2f;
  float feedback=0.3f;
  float spread=0.5f;
  float character=0;
  float freeze=0;
  float sr=48000;
  std::vector<float> bufL, bufR;
  int buf_size=0;
  int write_pos=0;
  float phase=0; // grain scheduler
  OnePoleLP lpL, lpR;
  // per-channel feedback filtered
  float fb_l=0, fb_r=0;

  void Resize(float s){
    sr=s;
    int size = int(s*3.2f)+1024;
    bufL.assign(size,0); bufR.assign(size,0);
    buf_size=size; write_pos=0; phase=0;
    lpL.Reset(); lpR.Reset();
  }
  float ReadLinear(const std::vector<float>& b,float pos) const{
    int size=(int)b.size();
    int i0=(int)std::floor(pos);
    float frac=pos - (float)i0;
    while(i0<0) i0+=size;
    i0%=size; int i1=(i0+1)%size;
    return b[i0]*(1-frac)+b[i1]*frac;
  }
};

GranularDelay::GranularDelay(): impl_(std::make_unique<Impl>()){ impl_->Resize(48000); }
GranularDelay::~GranularDelay()=default;

void GranularDelay::Reset(double sample_rate){ impl_->Resize(static_cast<float>(sample_rate)); }

void GranularDelay::Process(const float* const* input, float* const* output, int num_frames){
  const float sr = impl_->sr;
  float time_ms = impl_->time_ms;
  float grain_ms = impl_->grain_size_ms;
  float density = impl_->density;
  float pitch = impl_->pitch;
  float jitter = impl_->jitter;
  float fb = impl_->feedback;
  float spread = impl_->spread;
  float character = impl_->character;
  bool freeze = impl_->freeze >= 0.5f;

  float pitch_factor = std::pow(2.0f, pitch/12.0f);
  float grain_samps = grain_ms * sr / 1000.0f;
  if(grain_samps< 32) grain_samps=32;
  float delay_samps = time_ms * sr / 1000.0f;

  // character controls lowpass cutoff in feedback path: 0 pristine (12k), 1 lo-fi (1.5k)
  float cutoff = 12000.0f - character*10500.0f;
  float coeff = 1.0f - std::exp(-6.28318530718f*cutoff/sr);

  int wp = impl_->write_pos;
  int size = impl_->buf_size;
  float phase = impl_->phase;

  // For each sample, compute granular read via overlapping Hann grains
  // Use two grain streams offset by half grain period; density controls overall rate
  float grain_period = sr / std::max(1.0f, density); // samples between grains
  // jitter added as random offset per grain (pseudo)
  // Use deterministic pseudo-random via sin
  for(int i=0;i<num_frames;++i){
    float inL = input[0][i];
    float inR = input[1][i];

    // write with feedback, unless frozen
    if(!freeze){
      float fbL = impl_->lpL.Process(impl_->fb_l, coeff);
      float fbR = impl_->lpR.Process(impl_->fb_r, coeff);
      // add spread: cross-feed
      float wL = inL + fbL * fb * (1-spread*0.5f) + fbR * fb * spread*0.5f;
      float wR = inR + fbR * fb * (1-spread*0.5f) + fbL * fb * spread*0.5f;
      // character adds saturation when lo-fi
      if(character>0.5f){
        float drive = (character-0.5f)*2.0f;
        wL = std::tanh(wL*(1+drive*2));
        wR = std::tanh(wR*(1+drive*2));
      }
      impl_->bufL[wp]=wL;
      impl_->bufR[wp]=wR;
    }

    // granular read: two overlapping grains
    // phase advances 1 per sample; when phase >= grain_period, start new grain with jitter
    phase += 1.0f;
    if(phase >= grain_period) phase -= grain_period;

    // compute read positions for two grains staggered
    float read_base = (float)wp - delay_samps;
    // jitter offset: use sin with phase-dependent seed
    float jitter_off = 0;
    if(jitter>0.001f){
      // pseudo jitter: sin of wp + phase
      jitter_off = std::sin(phase*0.1f + wp*0.001f) * jitter * grain_samps * 0.5f;
    }
    // pitch shift via resampling speed: advance read faster/slower
    // we modulate read position by pitch_factor: read moves pitch_factor per sample within grain
    float grain_progress = phase / grain_period; // 0..1 within grain interval
    // actually grain progress for Hann
    // read pos for grain A
    float rA = read_base + jitter_off - grain_progress * grain_samps * (pitch_factor-1.0f)*0.2f;
    float rB = rA - grain_period*0.5f; // second grain half period offset
    while(rA<0) rA+=size;
    while(rB<0) rB+=size;
    float sAL = impl_->ReadLinear(impl_->bufL, rA);
    float sAR = impl_->ReadLinear(impl_->bufR, rA);
    float sBL = impl_->ReadLinear(impl_->bufL, rB);
    float sBR = impl_->ReadLinear(impl_->bufR, rB);
    // Hann windows
    float wA = 0.5f - 0.5f*std::cos(6.28318530718f*grain_progress);
    float wB = 0.5f - 0.5f*std::cos(6.28318530718f*std::fmod(grain_progress+0.5f,1.0f));
    float outL = sAL*wA + sBL*wB;
    float outR = sAR*wA + sBR*wB;
    // stereo spread: pan grains opposite
    float pan = spread;
    // simple: blend center vs wide
    float midL = outL * (1 - pan*0.3f);
    float midR = outR * (1 - pan*0.3f);
    // spread widens by mixing L/R
    outL = midL + outR*pan*0.2f;
    outR = midR + outL*pan*0.2f; // subtle

    output[0][i]=outL;
    output[1][i]=outR;
    // store feedback source for next write
    impl_->fb_l = outL;
    impl_->fb_r = outR;

    wp = (wp+1)%size;
  }
  impl_->write_pos = wp;
  impl_->phase = phase;
}

int GranularDelay::ParamCount(){ return kParamCount; }
const GranularDelay::ParamInfo& GranularDelay::GetParamInfo(int index){ return kParamInfo[static_cast<size_t>(index)]; }
float GranularDelay::GetParam(int index) const{
  switch(index){
    case kTimeParam: return impl_->time_ms;
    case kGrainSizeParam: return impl_->grain_size_ms;
    case kDensityParam: return impl_->density;
    case kPitchParam: return impl_->pitch;
    case kJitterParam: return impl_->jitter;
    case kFeedbackParam: return impl_->feedback;
    case kSpreadParam: return impl_->spread;
    case kCharacterParam: return impl_->character;
    case kFreezeParam: return impl_->freeze;
    default: return 0;
  }
}
void GranularDelay::SetParam(int index,float value){
  switch(index){
    case kTimeParam: impl_->time_ms=std::clamp(value,10.0f,2000.0f); break;
    case kGrainSizeParam: impl_->grain_size_ms=std::clamp(value,10.0f,500.0f); break;
    case kDensityParam: impl_->density=std::clamp(value,1.0f,50.0f); break;
    case kPitchParam: impl_->pitch=std::clamp(value,-12.0f,12.0f); break;
    case kJitterParam: impl_->jitter=std::clamp(value,0.0f,1.0f); break;
    case kFeedbackParam: impl_->feedback=std::clamp(value,0.0f,0.9f); break;
    case kSpreadParam: impl_->spread=std::clamp(value,0.0f,1.0f); break;
    case kCharacterParam: impl_->character=std::clamp(value,0.0f,1.0f); break;
    case kFreezeParam: impl_->freeze= value>=0.5f?1.0f:0.0f; break;
    default: break;
  }
}

} // namespace openaxe::dsp
