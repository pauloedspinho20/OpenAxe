#include "openaxe/api.h"

#include "test_harness.h"

int main() {
  NamStudioGraph* graph = nam_studio_graph_create();
  OPENAXE_EXPECT(graph != nullptr);

  nam_studio_graph_destroy(graph);
  nam_studio_graph_destroy(nullptr);  // must be a safe no-op

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
