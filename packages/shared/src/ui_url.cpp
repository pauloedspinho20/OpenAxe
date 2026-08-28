#include "openaxe/ui_url.h"

#include <cctype>

namespace openaxe {

bool IsTrustedUiUrl(const std::string& url) {
  std::string lower;
  lower.reserve(url.size());
  for (char c : url) lower.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));

  const size_t scheme_end = lower.find("://");
  if (scheme_end == std::string::npos) return false;
  const std::string scheme = lower.substr(0, scheme_end);
  if (scheme != "http" && scheme != "https") return false;

  std::string host = lower.substr(scheme_end + 3);
  const size_t slash = host.find('/');
  if (slash != std::string::npos) host = host.substr(0, slash);

  // Reject userinfo rather than strip it — see the header for why.
  if (host.find('@') != std::string::npos) return false;

  // Drop the port. rfind so an IPv6 literal's own colons are not mistaken for
  // the port separator: "[::1]:5173" -> "[::1]".
  const size_t colon = host.rfind(':');
  if (colon != std::string::npos) host = host.substr(0, colon);

  return host == "127.0.0.1" || host == "localhost" || host == "[::1]" || host == "::1";
}

}  // namespace openaxe
