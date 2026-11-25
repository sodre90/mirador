// Stands in for utf8proc where the rules are tested on names of plain letters, which never reach it.
#pragma once
#include <cstdint>
#include <cstdlib>
#include <cstring>

using utf8proc_uint8_t = uint8_t;
using utf8proc_ssize_t = long;
enum utf8proc_option_t { UTF8PROC_STABLE = 1, UTF8PROC_DECOMPOSE = 2, UTF8PROC_CASEFOLD = 4, UTF8PROC_IGNORE = 8 };

inline utf8proc_ssize_t utf8proc_map(const utf8proc_uint8_t* text, utf8proc_ssize_t length, utf8proc_uint8_t** mapped, utf8proc_option_t) {
  *mapped = static_cast<utf8proc_uint8_t*>(std::malloc(static_cast<size_t>(length)));
  std::memcpy(*mapped, text, static_cast<size_t>(length));
  return length;
}
