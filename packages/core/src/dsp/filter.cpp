#include "openaxe/dsp/filter.h"

#include <algorithm>
#include <cmath>
#include <vector>

// Phase 0 commons (issue #268) — shared Biquad, SVF, EnvelopeFollower etc.
#include "internal/biquad.h"
#include "internal/envelope_follower.h"
#include "internal/svf_tpt.h"

namespace openaxe::dsp {

namespace {
constexpr int kTypeParam = 0;
constexpr int kFrequencyParam = 1;
constexpr int kQParam = 2;
constexpr int kDriveParam = 3;
constexpr int kSensitivityParam = 4;
constexpr int kModeParam = 5;
constexpr int kLfoRateParam = 6;
constexpr int kParamCount = 7;

const Filter::ParamInfo kParamInfo[kParamCount] = {
#include "generated/filter_params.inc"
};

// Simple biquad (transposed direct form II)
struct Biquad {
  float b0=1,b1=0,b2=0,a1=0,a2=0;
  float z1=0,z2=0;
  void Reset(){ z1=z2=0; }
  void SetLowpass(float freq, float q, float sr){
    if(freq<=0||sr<=0){ b0=1;a1=a2=b1=b2=0; return; }
    float w0=6.28318530718f*freq/sr;
    float alpha=std::sin(w0)/(2.0f*q);
    float cosw=std::cos(w0);
    float a0=1+alpha;
    b0=(1-cosw)*0.5f/a0;
    b1=(1-cosw)/a0;
    b2=b0;
    a1=(-2*cosw)/a0;
    a2=(1-alpha)/a0;
  }
  void SetBandpass(float freq, float q, float sr){
    if(freq<=0||sr<=0){ b0=1;a1=a2=b1=b2=0; return; }
    float w0=6.28318530718f*freq/sr;
    float alpha=std::sin(w0)/(2.0f*q);
    float cosw=std::cos(w0);
    float a0=1+alpha;
    b0=alpha/a0;
    b1=0;
    b2=-alpha/a0;
    a1=(-2*cosw)/a0;
    a2=(1-alpha)/a0;
  }
  float Process(float x){
    float y = b0*x + z1;
    z1 = b1*x - a1*y + z2;
    z2 = b2*x - a2*y;
    return y;
  }
};

// 4-pole ladder approximation: 4 one-poles in series with feedback
struct Ladder {
  float stage[4] = {0,0,0,0};
  float freq=1000,q=1;
  float sr=48000;
  void Reset(){ for(int i=0;i<4;++i) stage[i]=0; }
  void Set(float f,float qq,float s){ freq=f; q=qq; sr=s; }
  float Process(float x){
    float g = 1.0f - std::exp(-6.28318530718f*freq/sr);
    g = std::clamp(g,0.01f,0.99f);
    float fb = q*0.35f; // resonance feedback
    float fb_sig = stage[3]*fb;
    float in = std::tanh(x - fb_sig);
    for(int i=0;i<4;++i){
      stage[i] += g*(in - stage[i]);
      in = stage[i];
    }
    return in;
  }
};

struct ChannelState {
  Biquad bq;
  Ladder ladder;
  float env = 0.0f;
  float lfo_phase = 0.0f;
};

} // namespace

struct Filter::Impl {
  float type = 0; // 0 wah,1 env,2 ladder
  float frequency = 800;
  float q = 2.0f;
  float drive = 0.0f;
  float sensitivity = 0.5f;
  float mode = 0; // 0 pedal,1 env,2 lfo
  float lfo_rate = 1.0f;
  float sr = 48000;
  ChannelState ch[2];

  void ResetState(){
    for(auto &c: ch){ c.bq.Reset(); c.ladder.Reset(); c.env=0; c.lfo_phase=0; }
  }
};

Filter::Filter(): impl_(std::make_unique<Impl>()){}
Filter::~Filter()=default;

void Filter::Reset(double sample_rate){
  impl_->sr = static_cast<float>(sample_rate);
  impl_->ResetState();
}

void Filter::Process(const float* const* input, float* const* output, int num_frames){
  const float sr = impl_->sr;
  const int type = static_cast<int>(impl_->type);
  const float base_freq = impl_->frequency;
  const float q = std::clamp(impl_->q, 0.5f, 10.0f);
  const float drive = impl_->drive;
  const float sens = impl_->sensitivity;
  const float lfo_rate = impl_->lfo_rate;
  const int mode = static_cast<int>(impl_->mode);

  for(int ch=0; ch<2; ++ch){
    ChannelState &c = impl_->ch[ch];
    float lfo_phase = c.lfo_phase;
    float env = c.env;
    for(int i=0;i<num_frames;++i){
      float in = input[ch][i];
      // envelope follower (attack ~5ms, release ~50ms)
      float abs_in = std::fabs(in);
      float alpha_a = 1.0f - std::exp(-1.0f/(0.005f*sr));
      float alpha_r = 1.0f - std::exp(-1.0f/(0.05f*sr));
      float alpha = abs_in > env ? alpha_a : alpha_r;
      env += alpha*(abs_in - env);

      // LFO
      float lfo = std::sin(lfo_phase);
      lfo_phase += 6.28318530718f*lfo_rate/sr;
      if(lfo_phase>=6.28318530718f) lfo_phase-=6.28318530718f;

      // Determine cutoff modulation
      float mod_freq = base_freq;
      if(type==0){ // Wah: mode selects modulation
        if(mode==1){ // envelope
          mod_freq = 350.0f + env * sens * 1850.0f;
        } else if(mode==2){ // lfo
          mod_freq = base_freq + lfo*600.0f*sens;
        } else { // pedal: base_freq directly (expression pedal drives frequency param)
        }
      } else if(type==1){ // Envelope filter always env driven
        mod_freq = 350.0f + env * sens * 1850.0f;
        // also add lfo if mode 2? blend
        if(mode==2) mod_freq += lfo*300.0f;
      }
      mod_freq = std::clamp(mod_freq, 20.0f, 5000.0f);

      // Apply drive saturation pre-filter
      float driven = in;
      if(drive>0.001f){
        driven = std::tanh(driven*(1.0f+drive*4.0f));
      }

      float out;
      if(type==2){ // ladder lowpass
        c.ladder.Set(mod_freq, q, sr);
        out = c.ladder.Process(driven);
      } else {
        // Wah/Envelope as bandpass, Ladder already handled
        c.bq.SetBandpass(mod_freq, q, sr);
        out = c.bq.Process(driven);
        // mix with drive? keep resonant peak
      }
      output[ch][i]=out;
    }
    c.lfo_phase = lfo_phase;
    c.env = env;
  }
}

int Filter::ParamCount(){ return kParamCount; }
const Filter::ParamInfo& Filter::GetParamInfo(int index){ return kParamInfo[static_cast<size_t>(index)]; }
float Filter::GetParam(int index) const{
  switch(index){
    case kTypeParam: return impl_->type;
    case kFrequencyParam: return impl_->frequency;
    case kQParam: return impl_->q;
    case kDriveParam: return impl_->drive;
    case kSensitivityParam: return impl_->sensitivity;
    case kModeParam: return impl_->mode;
    case kLfoRateParam: return impl_->lfo_rate;
    default: return 0;
  }
}
void Filter::SetParam(int index,float value){
  switch(index){
    case kTypeParam: impl_->type = std::clamp(std::round(value),0.0f,2.0f); break;
    case kFrequencyParam: impl_->frequency = std::clamp(value,350.0f,2200.0f); break;
    case kQParam: impl_->q = std::clamp(value,0.5f,10.0f); break;
    case kDriveParam: impl_->drive = std::clamp(value,0.0f,1.0f); break;
    case kSensitivityParam: impl_->sensitivity = std::clamp(value,0.0f,1.0f); break;
    case kModeParam: impl_->mode = std::clamp(std::round(value),0.0f,2.0f); break;
    case kLfoRateParam: impl_->lfo_rate = std::clamp(value,0.1f,10.0f); break;
    default: break;
  }
}

} // namespace openaxe::dsp
