#pragma once

#include <cstdio>

namespace openaxe::test {

inline int g_failures = 0;

inline void Check(bool condition, const char* expr, const char* file, int line) {
  if (!condition) {
    std::fprintf(stderr, "FAILED: %s (%s:%d)\n", expr, file, line);
    ++g_failures;
  }
}

}  // namespace openaxe::test

#define OPENAXE_EXPECT(cond) ::openaxe::test::Check((cond), #cond, __FILE__, __LINE__)
