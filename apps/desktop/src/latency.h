#pragma once

namespace nam_desktop {

// Issue #15 M5: latency measurement. The DSP path's added latency is what the
// shell controls (it must be well under the <5ms target; a sample-accurate
// passthrough adds 0). Device I/O latency is reported separately (buffer size
// / device), since it depends on the host hardware.

// Builds an IN->Mixer->OUT passthrough graph, feeds an impulse at
// `impulse_pos` (within a single block of `block_size` samples at
// `sample_rate`), and returns the *added* DSP latency in frames (peak index in
// the output minus the impulse position). A sample-accurate passthrough
// returns 0.
int MeasureDspLatencyFrames(double sample_rate, int block_size, int impulse_pos);

// Converts a latency in frames to milliseconds at the given sample rate.
double LatencyMs(int frames, double sample_rate);

}  // namespace nam_desktop