#include "nam_studio/api.h"

#include "nam_studio/graph_rig.h"

struct NamStudioGraph {
  nam_studio::graph::GraphRig rig;
};

extern "C" {

NamStudioGraph* nam_studio_graph_create(void) { return new NamStudioGraph(); }

void nam_studio_graph_destroy(NamStudioGraph* graph) { delete graph; }

}  // extern "C"
