#pragma once

namespace nam_studio::core {

// Placeholder API proving the packages/core build graph (native + Emscripten
// + iOS + Android) resolves end to end. The real DSP/inference surface
// (extern "C" API, audio graph engine, NAM model loading) lands in issue #14.
const char* version();

}  // namespace nam_studio::core
