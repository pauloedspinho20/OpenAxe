#include "openaxe/dsp/granular_delay.h"
#include "Effects/GranularProcessor.h"
#include "internal/dspark_wrapper.h"
#include "internal/lagrange3.h"
#include <vector>
#include <algorithm>
#include <cmath>
namespace openaxe::dsp {
namespace {
constexpr int kTimeParam=0; constexpr int kGrainSizeParam=1; constexpr int kDensityParam=2; constexpr int kPitchParam=3; constexpr int kJitterParam=4; constexpr int kFeedbackParam=5; constexpr int kSpreadParam=6; constexpr int kCharacterParam=7; constexpr int kFreezeParam=8; constexpr int kParamCount=9;
const DsparkParamInfo kParamInfo[kParamCount]={
#include "generated/granular_delay_params.inc"
};
constexpr float kLocalDefaults[kParamCount]={400.0f,80.0f,8.0f,0.0f,0.2f,0.3f,0.5f,0.0f,0.0f};
using GranularProc=dspark::GranularProcessor<float>;
struct GranularTraits{
 static constexpr int kParamCount=9;
 static constexpr const DsparkParamInfo* kInfo=kParamInfo;
 static constexpr const float* kDefaults=kLocalDefaults;
 static void Configure(GranularProc& p){ p.setMix(1.0f); }
 static void Apply(GranularProc& p,const float* v,int, float){
  p.setGrainSize(v[kGrainSizeParam]);
  p.setDensity(v[kDensityParam]);
  p.setJitter(v[kJitterParam]);
  p.setPitch(v[kPitchParam]);
  p.setSpread(v[kSpreadParam]);
  p.setFreeze(v[kFreezeParam] >= 0.5f);
 }
};
struct OnePoleLP{ float y=0; float Process(float x,float c){ y+=c*(x-y); return y; } void Reset(){y=0;} };
}
struct GranularDelay::Impl{
 DsparkEffect<GranularProc, GranularTraits> dsp;
 float time_ms=400, feedback=0.3, character=0;
 float sr=48000;
 std::vector<float> bufL, bufR;
 int buf_size=0, write_pos=0;
 OnePoleLP lpL, lpR;
 float fb_l=0, fb_r=0;
 void Resize(float s){
  sr=s; buf_size=int(s*2.2f)+1024; bufL.assign(buf_size,0); bufR.assign(buf_size,0); write_pos=0; lpL.Reset(); lpR.Reset(); fb_l=fb_r=0;
 }
};
GranularDelay::GranularDelay():impl_(std::make_unique<Impl>()){impl_->Resize(48000);}
GranularDelay::~GranularDelay()=default;
void GranularDelay::Reset(double sr){ impl_->Resize(sr); impl_->dsp.Reset(sr); }
void GranularDelay::Process(const float* const* in,float* const* out,int n){
 const float sr=impl_->sr; const float time_ms=impl_->time_ms; const float fb=impl_->feedback; const float character=impl_->character;
 float delay_samps=time_ms*sr/1000.0f;
 float cutoff=12000 - character*10500; float coeff=1-std::exp(-6.28318530718f*cutoff/sr);
 int wp=impl_->write_pos; int size=impl_->buf_size;
 std::vector<float> tempL(n), tempR(n);
 for(int i=0;i<n;++i){
  float inL=in[0][i], inR=in[1][i];
  float read_pos = (float)wp - delay_samps; while(read_pos<0) read_pos+=size;
  int i0=(int)read_pos; float frac=read_pos-i0; i0%=size; int i1=(i0+1)%size;
  float dL=impl_->bufL[i0]*(1-frac)+impl_->bufL[i1]*frac;
  float dR=impl_->bufR[i0]*(1-frac)+impl_->bufR[i1]*frac;
  float fbL=impl_->lpL.Process(impl_->fb_l,coeff);
  float fbR=impl_->lpR.Process(impl_->fb_r,coeff);
  float wL=inL+fbL*fb;
  float wR=inR+fbR*fb;
  if(!(impl_->dsp.GetParam(kFreezeParam)>=0.5f)){
   impl_->bufL[wp]=wL;
   impl_->bufR[wp]=wR;
  }
  tempL[i]=dL;
  tempR[i]=dR;
  impl_->fb_l=dL;
  impl_->fb_r=dR;
  wp=(wp+1)%size;
 }
 impl_->write_pos=wp;
 const float* tin[2]={tempL.data(), tempR.data()};
 float* tout[2]={out[0], out[1]};
 impl_->dsp.Process(tin,tout,n);
}
int GranularDelay::ParamCount(){return kParamCount;}
const GranularDelay::ParamInfo& GranularDelay::GetParamInfo(int i){return kParamInfo[i];}
float GranularDelay::GetParam(int i)const{
 switch(i){case kTimeParam:return impl_->time_ms;case kGrainSizeParam:return impl_->dsp.GetParam(kGrainSizeParam);case kDensityParam:return impl_->dsp.GetParam(kDensityParam);case kPitchParam:return impl_->dsp.GetParam(kPitchParam);case kJitterParam:return impl_->dsp.GetParam(kJitterParam);case kFeedbackParam:return impl_->feedback;case kSpreadParam:return impl_->dsp.GetParam(kSpreadParam);case kCharacterParam:return impl_->character;case kFreezeParam:return impl_->dsp.GetParam(kFreezeParam) >= 0.5f ? 1.0f : 0.0f;default:return 0;}
}
void GranularDelay::SetParam(int i,float v){
 switch(i){
  case kTimeParam: impl_->time_ms=std::clamp(v,10.0f,2000.0f); break;
  case kGrainSizeParam: impl_->dsp.SetParam(kGrainSizeParam, v); break;
  case kDensityParam: impl_->dsp.SetParam(kDensityParam, v); break;
  case kPitchParam: impl_->dsp.SetParam(kPitchParam, v); break;
  case kJitterParam: impl_->dsp.SetParam(kJitterParam, v); break;
  case kFeedbackParam: impl_->feedback=std::clamp(v,0.0f,0.9f); break;
  case kSpreadParam: impl_->dsp.SetParam(kSpreadParam, v); break;
  case kCharacterParam: impl_->character=std::clamp(v,0.0f,1.0f); break;
  case kFreezeParam: impl_->dsp.SetParam(kFreezeParam, v); break;
  default: break;
 }
}
}
