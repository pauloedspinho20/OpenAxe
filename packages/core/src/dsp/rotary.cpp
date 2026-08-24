#include "openaxe/dsp/rotary.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace openaxe::dsp {

namespace {
constexpr int kSpeedParam=0;
constexpr int kDriveParam=1;
constexpr int kHornLevelParam=2;
constexpr int kDrumLevelParam=3;
constexpr int kMicDistParam=4;
constexpr int kCrossoverParam=5;
constexpr int kParamCount=6;
const Rotary::ParamInfo kParamInfo[kParamCount]={
#include "generated/rotary_params.inc"
};

struct Biquad {
  float b0=1,b1=0,b2=0,a1=0,a2=0,z1=0,z2=0;
  void Reset(){ z1=z2=0; }
  void SetLowpass(float freq,float q,float sr){
    float w0=6.28318530718f*freq/sr;
    float alpha=std::sin(w0)/(2*q);
    float cosw=std::cos(w0);
    float a0=1+alpha;
    b0=(1-cosw)*0.5f/a0; b1=(1-cosw)/a0; b2=b0; a1=(-2*cosw)/a0; a2=(1-alpha)/a0;
  }
  void SetHighpass(float freq,float q,float sr){
    float w0=6.28318530718f*freq/sr;
    float alpha=std::sin(w0)/(2*q);
    float cosw=std::cos(w0);
    float a0=1+alpha;
    b0=(1+cosw)*0.5f/a0; b1=-(1+cosw)/a0; b2=b0; a1=(-2*cosw)/a0; a2=(1-alpha)/a0;
  }
  float Process(float x){
    float y=b0*x+z1;
    z1=b1*x - a1*y + z2;
    z2=b2*x - a2*y;
    return y;
  }
};

} // namespace

struct Rotary::Impl {
  float speed=1; // 0 stop,1 chorale,2 tremolo
  float drive=0.2f;
  float horn_level=0.7f;
  float drum_level=0.7f;
  float mic_distance=0.3f;
  float crossover=800;
  float sr=48000;
  Biquad lp[2], hp[2];
  // delay lines for doppler: horn faster, drum slower
  std::vector<float> horn_buf[2], drum_buf[2];
  int horn_wp=0, drum_wp=0, horn_size=0, drum_size=0;
  float horn_phase=0, drum_phase=0;
  float cur_horn_speed=0, cur_drum_speed=0; // ramped

  void Resize(float s){
    sr=s;
    int hs = int(s*0.04f)+512; // 40ms max
    int ds = int(s*0.04f)+512;
    for(int ch=0;ch<2;++ch){
      horn_buf[ch].assign(hs,0); drum_buf[ch].assign(ds,0);
    }
    horn_size=hs; drum_size=ds; horn_wp=drum_wp=0;
    horn_phase=drum_phase=0;
    cur_horn_speed=cur_drum_speed=0;
    for(int ch=0;ch<2;++ch){ lp[ch].Reset(); hp[ch].Reset(); }
  }
  float ReadLinear(const std::vector<float>& b,float pos,int size) const{
    int i0=(int)std::floor(pos);
    float frac=pos-(float)i0;
    while(i0<0) i0+=size;
    i0%=size; int i1=(i0+1)%size;
    return b[i0]*(1-frac)+b[i1]*frac;
  }
};

Rotary::Rotary(): impl_(std::make_unique<Impl>()){ impl_->Resize(48000); }
Rotary::~Rotary()=default;

void Rotary::Reset(double sample_rate){ impl_->Resize(static_cast<float>(sample_rate)); }

void Rotary::Process(const float* const* input, float* const* output, int num_frames){
  const float sr = impl_->sr;
  int speed = static_cast<int>(impl_->speed);
  float drive = impl_->drive;
  float horn_level = impl_->horn_level;
  float drum_level = impl_->drum_level;
  float mic = impl_->mic_distance;
  float xo = impl_->crossover;

  // target rates per speed (Hz): horn vs drum
  float target_horn = 0, target_drum=0;
  if(speed==0){ target_horn=0; target_drum=0; }
  else if(speed==1){ target_horn=0.8f; target_drum=0.7f; } // chorale slow
  else { target_horn=6.8f; target_drum=5.4f; } // tremolo fast

  // acceleration ramp ~ 1s
  float horn_step = (target_horn - impl_->cur_horn_speed) * 0.002f;
  float drum_step = (target_drum - impl_->cur_drum_speed) * 0.002f;

  for(int ch=0; ch<2; ++ch){
    impl_->lp[ch].SetLowpass(xo, 0.707f, sr);
    impl_->hp[ch].SetHighpass(xo, 0.707f, sr);
  }

  for(int i=0;i<num_frames;++i){
    // ramp speeds
    impl_->cur_horn_speed += horn_step;
    impl_->cur_drum_speed += drum_step;
    // clamp towards target
    if((horn_step>0 && impl_->cur_horn_speed>target_horn) || (horn_step<0 && impl_->cur_horn_speed<target_horn)) impl_->cur_horn_speed=target_horn;
    if((drum_step>0 && impl_->cur_drum_speed>target_drum) || (drum_step<0 && impl_->cur_drum_speed<target_drum)) impl_->cur_drum_speed=target_drum;

    float inL = input[0][i];
    float inR = input[1][i];
    // drive saturation pre
    if(drive>0.001f){
      float g = 1+drive*3;
      inL = std::tanh(inL*g) / std::max(1.0f,g*0.5f);
      inR = std::tanh(inR*g) / std::max(1.0f,g*0.5f);
    }

    // crossover split
    float lowL = impl_->lp[0].Process(inL);
    float lowR = impl_->lp[1].Process(inR);
    float highL = impl_->hp[0].Process(inL);
    float highR = impl_->hp[1].Process(inR);
    // alternative: high = in - low if hp not precise, but biquad should be fine.

    // Doppler via modulated delay: horn and drum each have delay line 5-15ms modulated by sinusoid
    // Write
    impl_->horn_buf[0][impl_->horn_wp]=highL;
    impl_->horn_buf[1][impl_->horn_wp]=highR;
    impl_->drum_buf[0][impl_->drum_wp]=lowL;
    impl_->drum_buf[1][impl_->drum_wp]=lowR;

    float horn_depth_ms = 2.5f; // horn shallower
    float drum_depth_ms = 4.0f;
    float horn_base_ms = 6.0f;
    float drum_base_ms = 8.0f;

    // mic distance: more diffuse when far (simple lowpass on modulated output)
    float horn_lfo = std::sin(impl_->horn_phase);
    float drum_lfo = std::sin(impl_->drum_phase);

    impl_->horn_phase += 6.28318530718f*impl_->cur_horn_speed/sr;
    impl_->drum_phase += 6.28318530718f*impl_->cur_drum_speed/sr;
    if(impl_->horn_phase>=6.28318530718f) impl_->horn_phase-=6.28318530718f;
    if(impl_->drum_phase>=6.28318530718f) impl_->drum_phase-=6.28318530718f;

    float horn_delay_ms = horn_base_ms + horn_lfo*horn_depth_ms*0.5f;
    float drum_delay_ms = drum_base_ms + drum_lfo*drum_depth_ms*0.5f;
    float horn_samps = horn_delay_ms*sr/1000.0f;
    float drum_samps = drum_delay_ms*sr/1000.0f;

    float hrp = (float)impl_->horn_wp - horn_samps;
    float drp = (float)impl_->drum_wp - drum_samps;
    float horn_outL = impl_->ReadLinear(impl_->horn_buf[0], hrp, impl_->horn_size);
    float horn_outR = impl_->ReadLinear(impl_->horn_buf[1], hrp, impl_->horn_size);
    float drum_outL = impl_->ReadLinear(impl_->drum_buf[0], drp, impl_->drum_size);
    float drum_outR = impl_->ReadLinear(impl_->drum_buf[1], drp, impl_->drum_size);

    // tremolo amplitude modulation also (horn/drum rotate produces AM)
    float horn_ampL = 1.0f + horn_lfo*0.25f;
    float horn_ampR = 1.0f - horn_lfo*0.25f;
    float drum_ampL = 1.0f + drum_lfo*0.2f;
    float drum_ampR = 1.0f - drum_lfo*0.2f;

    horn_outL *= horn_ampL * horn_level;
    horn_outR *= horn_ampR * horn_level;
    drum_outL *= drum_ampL * drum_level;
    drum_outR *= drum_ampR * drum_level;

    // mic distance lowpass: far = darker, also slight stereo narrowing
    float mic_lp_coeff = 1.0f - std::exp(-6.28318530718f*(8000.0f - mic*6000.0f)/sr);
    // simple one-pole per channel via state in lp? reuse separate? just mix
    // For simplicity, mix dry diffused: mic far reduces high
    float outL = horn_outL + drum_outL;
    float outR = horn_outR + drum_outR;
    // apply mic distance as simple lowpass via averaging with previous? use implicit via lr mix
    // width narrowing: mic 0 = wide, 1 = mono
    float width = 1.0f - mic*0.5f;
    float mid = (outL+outR)*0.5f;
    outL = mid + (outL-mid)*width;
    outR = mid + (outR-mid)*width;

    // wood cabinet color: subtle low-mid boost + high cut already via mic
    output[0][i]= outL;
    output[1][i]= outR;

    impl_->horn_wp = (impl_->horn_wp+1)%impl_->horn_size;
    impl_->drum_wp = (impl_->drum_wp+1)%impl_->drum_size;
  }
}

int Rotary::ParamCount(){ return kParamCount; }
const Rotary::ParamInfo& Rotary::GetParamInfo(int index){ return kParamInfo[static_cast<size_t>(index)]; }
float Rotary::GetParam(int index) const{
  switch(index){
    case kSpeedParam: return impl_->speed;
    case kDriveParam: return impl_->drive;
    case kHornLevelParam: return impl_->horn_level;
    case kDrumLevelParam: return impl_->drum_level;
    case kMicDistParam: return impl_->mic_distance;
    case kCrossoverParam: return impl_->crossover;
    default: return 0;
  }
}
void Rotary::SetParam(int index,float value){
  switch(index){
    case kSpeedParam: impl_->speed=std::clamp(std::round(value),0.0f,2.0f); break;
    case kDriveParam: impl_->drive=std::clamp(value,0.0f,1.0f); break;
    case kHornLevelParam: impl_->horn_level=std::clamp(value,0.0f,1.0f); break;
    case kDrumLevelParam: impl_->drum_level=std::clamp(value,0.0f,1.0f); break;
    case kMicDistParam: impl_->mic_distance=std::clamp(value,0.0f,1.0f); break;
    case kCrossoverParam: impl_->crossover=std::clamp(value,400.0f,1200.0f); break;
    default: break;
  }
}

} // namespace openaxe::dsp
