#include "openaxe/api.h"

#include "test_harness.h"

int main() {
  OpenAxeGraph* graph = openaxe_graph_create();
  OPENAXE_EXPECT(graph != nullptr);

  openaxe_graph_destroy(graph);
  openaxe_graph_destroy(nullptr);  // must be a safe no-op

  return openaxe::test::g_failures == 0 ? 0 : 1;
}
