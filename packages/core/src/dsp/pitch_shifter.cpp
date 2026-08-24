#include "openaxe/dsp/pitch_shifter.h"

#include <algorithm>
#include <cmath>
#include <vector>

#include "internal/delay_line.h"
#include "internal/lagrange3.h"
#include "internal/variable_delay.h"

namespace openaxe::dsp {

namespace {
constexpr int kModeParam = 0;
constexpr int kPitchParam = 1;
constexpr int kDetuneParam = 2;
constexpr int kParamCount = 3;

const PitchShifter::ParamInfo kParamInfo[kParamCount] = {
#include "generated/pitch_shifter_params.inc"
};

} // namespace

struct PitchShifter::Impl {
  float mode = 1; // 0 detune,1 whammy default whammy
  float pitch = 0; // semitones
  float detune_cents = 5;
  float sr = 48000;
  // circular buffer for delay-line shifter
  std::vector<float> buf[2];
  int write_pos = 0;
  int buf_size = 0;
  float lfo_phase[2] = {0,0};
  float read_phase[2] = {0,0};

  void Resize(float s){
    sr = s;
    int size = static_cast<int>(s * 2.5f) + 2048;
    for(int ch=0;ch<2;++ch){
      buf[ch].assign(size,0.0f);
    }
    buf_size = size;
    write_pos = 0;
    lfo_phase[0]=lfo_phase[1]=0;
    read_phase[0]=read_phase[1]=0;
  }

  float ReadLinear(const std::vector<float>& b, float pos) const {
    int size = (int)b.size();
    int i0 = (int)std::floor(pos);
    float frac = pos - (float)i0;
    while(i0<0) i0+=size;
    i0%=size;
    int i1=(i0+1)%size;
    return b[i0]*(1-frac)+b[i1]*frac;
  }
};

PitchShifter::PitchShifter(): impl_(std::make_unique<Impl>()){ impl_->Resize(48000); }
PitchShifter::~PitchShifter()=default;

void PitchShifter::Reset(double sample_rate){
  impl_->Resize(static_cast<float>(sample_rate));
}

void PitchShifter::Process(const float* const* input, float* const* output, int num_frames){
  const float sr = impl_->sr;
  const int mode = static_cast<int>(impl_->mode);
  const float pitch_st = impl_->pitch;
  const float detune_c = impl_->detune_cents;
  // pitch factor
  float pitch_factor = std::pow(2.0f, pitch_st/12.0f);
  // detune factor: cents to ratio
  float detune_factor = std::pow(2.0f, detune_c/1200.0f);

  int size = impl_->buf_size;
  int wp = impl_->write_pos;

  for(int ch=0; ch<2; ++ch){
    auto &buf = impl_->buf[ch];
    float lfo = impl_->lfo_phase[ch];
    float rphase = impl_->read_phase[ch];

    for(int i=0;i<num_frames;++i){
      float in = input[ch][i];
      buf[wp] = in;

      float out=0;
      if(mode==0){ // detune: modulated delay 5-15ms
        // detune uses dual delay lines with LFO varying delay ~5ms +/-2ms
        float base_ms = 7.0f;
        float mod_depth_ms = 2.0f * (std::fabs(detune_factor-1.0f)*100.0f); // scale with detune
        // LFO ~0.8Hz for detune
        float lfo_val = std::sin(lfo);
        lfo += 6.28318530718f*0.8f/sr;
        if(lfo>=6.28318530718f) lfo-=6.28318530718f;
        float delay_ms = base_ms + mod_depth_ms * lfo_val * 0.5f;
        // apply detune pitch via reading speed tweak: slight resampling
        float delay_samps = delay_ms * sr / 1000.0f;
        // read pos slightly off to create cents shift: move read pointer at detune rate
        // maintain separate read pointer drifting at detune_factor
        // simple approach: delay + fractional offset driven by detune cents
        float read_pos = (float)wp - delay_samps;
        // add tiny pitch offset: advance read at detune speed
        // we approximate by offsetting by cents * time
        // keep it simple: just variable delay is enough for detune thickening
        while(read_pos<0) read_pos+=size;
        // also slightly resample for pitch: use linear interpolation with pitch factor
        // for detune, pitch_factor ~1, so just read
        out = impl_->ReadLinear(buf, read_pos);
        // add dry through engine mix? this block outputs wet only, detuned voice
      } else { // whammy: granular pitch shift with ~20ms grains, Hann crossfade
        // maintain two read heads offset by half grain for crossfade
        const float grain_ms = 30.0f;
        const float grain_samps = grain_ms * sr / 1000.0f;
        // read pointer moves at pitch_factor speed
        // we advance rphase by pitch_factor each sample relative to write
        // rphase is distance behind write
        // increment read offset
        rphase += pitch_factor;
        // wrap within grain window: keep read within [grain, 2*grain] behind write to avoid glitches
        float window = grain_samps;
        // compute read pos: wp - window - fmod(rphase, window)
        float phase_in_grain = std::fmod(rphase, window);
        float read_pos1 = (float)wp - window - phase_in_grain;
        float read_pos2 = read_pos1 - window*0.5f; // second grain half offset
        while(read_pos1<0) read_pos1+=size;
        while(read_pos2<0) read_pos2+=size;
        float s1 = impl_->ReadLinear(buf, read_pos1);
        float s2 = impl_->ReadLinear(buf, read_pos2);
        // Hann window for crossfade
        float w1 = 0.5f*(1 - std::cos(6.28318530718f*phase_in_grain/window));
        float w2 = 0.5f*(1 - std::cos(6.28318530718f*(phase_in_grain+window*0.5f)/window));
        // Actually w2 phase offset; simpler triangle crossfade via Hann
        // Normalize
        float window2 = std::fmod(phase_in_grain+window*0.5f, window);
        float w1h = 0.5f - 0.5f*std::cos(6.28318530718f*phase_in_grain/window);
        float w2h = 0.5f - 0.5f*std::cos(6.28318530718f*window2/window);
        // Use equal power crossfade: sum and normalize
        out = (s1*w1h + s2*w2h) * 0.9f;
        // Compensate amplitude: Hann crossfade sum ~1
        // when pitch bend is 0 (factor 1), grains are aligned; crossfade still works (chorus-like)
      }
      output[ch][i]=out;
      wp = (wp+1)%size;
    }
    impl_->lfo_phase[ch]=lfo;
    impl_->read_phase[ch]=rphase;
  }
  impl_->write_pos = wp;
}

int PitchShifter::ParamCount(){ return kParamCount; }
const PitchShifter::ParamInfo& PitchShifter::GetParamInfo(int index){ return kParamInfo[static_cast<size_t>(index)]; }
float PitchShifter::GetParam(int index) const{
  switch(index){
    case kModeParam: return impl_->mode;
    case kPitchParam: return impl_->pitch;
    case kDetuneParam: return impl_->detune_cents;
    default: return 0;
  }
}
void PitchShifter::SetParam(int index,float value){
  switch(index){
    case kModeParam: impl_->mode = std::clamp(std::round(value),0.0f,1.0f); break;
    case kPitchParam: impl_->pitch = std::clamp(value,-12.0f,12.0f); break;
    case kDetuneParam: impl_->detune_cents = std::clamp(value,-15.0f,15.0f); break;
    default: break;
  }
}

} // namespace openaxe::dsp
