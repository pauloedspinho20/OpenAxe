// Empty on purpose. The openaxe_core_wasm executable target (see
// CMakeLists.txt's `if(EMSCRIPTEN)` branch) exists only to give Emscripten
// something to link into a MODULARIZE=1 factory module - it exports
// openaxe_core's extern "C" API (api.h), not anything declared here.
// Emscripten doesn't require a main() for this pattern (the resulting JS
// factory's Promise resolves once the WASM runtime is ready; nothing needs
// to "run").
