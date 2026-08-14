#pragma once

#include <cstdio>

namespace nam_studio::test {

inline int g_failures = 0;

inline void Check(bool condition, const char* expr, const char* file, int line) {
  if (!condition) {
    std::fprintf(stderr, "FAILED: %s (%s:%d)\n", expr, file, line);
    ++g_failures;
  }
}

}  // namespace nam_studio::test

#define NAM_EXPECT(cond) ::nam_studio::test::Check((cond), #cond, __FILE__, __LINE__)
