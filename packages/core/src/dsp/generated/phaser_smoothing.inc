// GENERATED FILE - do not edit by hand.
// Produced by scripts/gen-param-schema.mjs from packages/core/param_schema.json.
// One ParamSmoothing row per param, in the same order as the matching
// <base>_params.inc fragment, so engine.cpp can #include both into parallel
// arrays. See openaxe/dsp/smoothing.h for the struct and the ramp math.
    {openaxe::dsp::SmoothingMode::kExponential, 0.05f, 0.1f, 5.0f},
    {openaxe::dsp::SmoothingMode::kExponential, 0.02f, 0.1f, 1.0f},
    {openaxe::dsp::SmoothingMode::kExponential, 0.02f, 0.0f, 0.9f},
    {openaxe::dsp::SmoothingMode::kNone, 0.0f, 2.0f, 8.0f},
    {openaxe::dsp::SmoothingMode::kExponential, 0.03f, 100.0f, 2000.0f},
    {openaxe::dsp::SmoothingMode::kExponential, 0.03f, 100.0f, 5000.0f},
    {openaxe::dsp::SmoothingMode::kNone, 0.0f, 0.0f, 2.0f},
    {openaxe::dsp::SmoothingMode::kExponential, 0.03f, 0.0f, 1.0f},
