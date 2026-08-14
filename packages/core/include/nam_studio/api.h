#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// Opaque handle wrapping a nam_studio::graph::GraphRig. This is the seed of
// the public C ABI every platform target (#15 desktop, #16 VST3, #17
// mobile) will link against - deliberately lifecycle + topology only.
// Real-time entrypoints (nam_studio_process, nam_studio_load_nam_model,
// etc.) are declared nowhere yet; they land once a real-time audio wiring
// design exists - declaring them now would just be an ABI to break later.
typedef struct NamStudioGraph NamStudioGraph;

// Never returns NULL.
NamStudioGraph* nam_studio_graph_create(void);
// NULL is a no-op.
void nam_studio_graph_destroy(NamStudioGraph* graph);

#ifdef __cplusplus
}
#endif
