#include "openaxe/dsp/phaser.h"
#include "Effects/Phaser.h"
#include "internal/dspark_wrapper.h"
namespace openaxe::dsp {
namespace {
constexpr int kRateParam=0; constexpr int kDepthParam=1; constexpr int kFeedbackParam=2; constexpr int kStagesParam=3; constexpr int kCenterParam=4; constexpr int kRangeParam=5; constexpr int kWaveformParam=6; constexpr int kSpreadParam=7; constexpr int kParamCount=8;
const DsparkParamInfo kParamInfo[kParamCount] = {
#include "generated/phaser_params.inc"
};
constexpr float kDefaults[kParamCount]={0.2f,0.6f,0.35f,4.0f,800.0f,1000.0f,0.0f,0.5f};
using PhaserProc=dspark::Phaser<float>;
struct PhaserTraits{
 static constexpr int kParamCount=8;
 static constexpr const DsparkParamInfo* kInfo=kParamInfo;
 static constexpr const float* kDefaults=openaxe::dsp::kDefaults;
 static void Configure(PhaserProc& p){p.setMix(1.0f);}
 static void Apply(PhaserProc& p,const float* v,int,float){
  p.setRate(v[kRateParam]); p.setDepth(v[kDepthParam]); p.setFeedback(v[kFeedbackParam]); p.setStages((int)v[kStagesParam]);
  float c=v[kCenterParam]; float r=v[kRangeParam]; p.setCenterFrequency(c); p.setFrequencyRange(c-r*0.5f,c+r*0.5f);
  p.setLfoWaveform(static_cast<typename dspark::Oscillator<float>::Waveform>((int)v[kWaveformParam]));
  p.setStereoSpread(v[kSpreadParam]);
 }
};
}
struct Phaser::Impl{ DsparkEffect<PhaserProc,PhaserTraits> dsp; };
Phaser::Phaser():impl_(std::make_unique<Impl>()){} Phaser::~Phaser()=default;
void Phaser::Reset(double sr){impl_->dsp.Reset(sr);} void Phaser::Process(const float* const* in,float* const* out,int n){impl_->dsp.Process(in,out,n);}
int Phaser::ParamCount(){return DsparkEffect<PhaserProc,PhaserTraits>::ParamCount();}
const Phaser::ParamInfo& Phaser::GetParamInfo(int i){return DsparkEffect<PhaserProc,PhaserTraits>::GetParamInfo(i);}
float Phaser::GetParam(int i)const{return impl_->dsp.GetParam(i);} void Phaser::SetParam(int i,float v){impl_->dsp.SetParam(i,v);}
}
