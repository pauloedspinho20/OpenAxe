// Standalone entry point — reuses the same NamStudioPlugin DSP path.
// iPlug2 standalone hosts provide their own main; this stub lets `cmake --build`
// produce a runnable binary without a DAW for iteration (issue #125).
#include <cstdio>

int main() {
  // The real standalone target is driven by iPlug2's IPlugAPP; this smoke
  // covers the case where iPlug2 isn't fetched yet.
  std::printf("OpenAxe standalone scaffold — plugin DSP is passthrough until wired.\n");
  return 0;
}
