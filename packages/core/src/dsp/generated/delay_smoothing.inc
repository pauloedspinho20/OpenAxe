// GENERATED FILE - do not edit by hand.
// Produced by scripts/gen-param-schema.mjs from packages/core/param_schema.json.
// One ParamSmoothing row per param, in the same order as the matching
// <base>_params.inc fragment, so engine.cpp can #include both into parallel
// arrays. See nam_studio/dsp/smoothing.h for the struct and the ramp math.
    {nam_studio::dsp::SmoothingMode::kNone, 0.0f, 10.0f, 1000.0f},
    {nam_studio::dsp::SmoothingMode::kExponential, 0.02f, 0.0f, 0.9f},
    {nam_studio::dsp::SmoothingMode::kExponential, 0.02f, 200.0f, 12000.0f},
    {nam_studio::dsp::SmoothingMode::kNone, 0.0f, 0.0f, 2.0f},
    {nam_studio::dsp::SmoothingMode::kNone, 0.0f, 0.0f, 5.0f},
    {nam_studio::dsp::SmoothingMode::kNone, 0.0f, 0.1f, 3.0f},
