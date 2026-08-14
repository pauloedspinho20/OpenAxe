#include "nam_studio/api.h"

#include "test_harness.h"

int main() {
  NamStudioGraph* graph = nam_studio_graph_create();
  NAM_EXPECT(graph != nullptr);

  nam_studio_graph_destroy(graph);
  nam_studio_graph_destroy(nullptr);  // must be a safe no-op

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
