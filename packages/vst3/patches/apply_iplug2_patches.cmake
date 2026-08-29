# Patch the vendored iPlug2 for a webview teardown crash (issue #300).
#
# IWebViewImpl::CloseWebView() drops its own reference to the script message
# handler but never unregisters it from the WKUserContentController:
#
#     mWKWebView = nil;
#     mScriptMessageHandler = nil;      // <- controller still retains it
#
# The controller keeps the handler alive, and the handler's mIWebView back
# pointer is only cleared in its dealloc — which cannot run while the
# controller holds a reference. Any script message the web process had already
# queued is then delivered to a destroyed IWebView:
#
#     mIWebView->OnMessageFromWebView(...)   // EXC_BAD_ACCESS
#
# That is a host crash on editor close, and our UI polls continuously (meters,
# scope, tuner) so there is almost always a message in flight. Reproduced with
# pluginval's Editor test; backtrace ends in
# -[IPLUG_WKSCRIPTMESSAGEHANDLER userContentController:didReceiveScriptMessage:].
#
# Two belt-and-braces edits, applied idempotently by string replacement rather
# than a context diff so a future iPlug2 bump does not fail on line drift:
#   1. Unregister the handler before dropping it.
#   2. Null-guard the handler itself, for messages already dispatched.
#
# Upstream-worthy; keep this file until it is fixed there.

set(_mm "${IPLUG2_SRC}/IPlug/Extras/WebView/IPlugWebView_mac.mm")
set(_handler "${IPLUG2_SRC}/IPlug/Extras/WebView/IPlugWKWebViewScriptMessageHandler.mm")

# A silent no-op is the dangerous failure here: if an iPlug2 bump moves this
# code, a string replacement that quietly matches nothing puts the host crash
# straight back with nothing to notice it. So every edit either applies, is
# already applied, or stops the configure.
if(NOT EXISTS "${_mm}")
  message(FATAL_ERROR
    "packages/vst3: expected ${_mm} to exist. If iPlug2 moved its webview "
    "sources, update patches/apply_iplug2_patches.cmake — do not just delete "
    "this check; the patch it applies prevents a host crash on editor close.")
endif()

if(EXISTS "${_mm}")
  file(READ "${_mm}" _s)
  if(NOT _s MATCHES "removeScriptMessageHandlerForName")
    string(REPLACE
      "  mWebConfig = nil;\n  mWKWebView = nil;\n  mScriptMessageHandler = nil;"
      "  // OpenAxe patch (#300): unregister before dropping our reference, or the\n  // controller keeps the handler alive with a dangling mIWebView and any\n  // queued script message crashes the host on editor close.\n  if (mWebConfig != nil && mScriptMessageHandler != nil)\n  {\n    [mWebConfig.userContentController removeScriptMessageHandlerForName:@\"callback\"];\n  }\n\n  mWebConfig = nil;\n  mWKWebView = nil;\n  mScriptMessageHandler = nil;"
      _s "${_s}")
    if(NOT _s MATCHES "removeScriptMessageHandlerForName")
      message(FATAL_ERROR
        "packages/vst3: could not patch iPlug2 CloseWebView — the expected text "
        "was not found, so the anchor has drifted with an iPlug2 bump. Fix the "
        "replacement in patches/apply_iplug2_patches.cmake. Without it, closing "
        "the plugin editor can crash the host (issue #300).")
    endif()
    file(WRITE "${_mm}" "${_s}")
    message(STATUS "packages/vst3: patched iPlug2 CloseWebView (script message handler unregister)")
  endif()
endif()

if(EXISTS "${_handler}")
  file(READ "${_handler}" _h)
  if(NOT _h MATCHES "OpenAxe patch")
    string(REPLACE
      "  if ([[message name] isEqualToString:@\"callback\"])\n  {"
      "  // OpenAxe patch (#300): the controller can outlive the IWebView and\n  // deliver messages queued before teardown.\n  if (mIWebView == nullptr) return;\n\n  if ([[message name] isEqualToString:@\"callback\"])\n  {"
      _h "${_h}")
    if(NOT _h MATCHES "OpenAxe patch")
      message(FATAL_ERROR
        "packages/vst3: could not patch IPlugWKWebViewScriptMessageHandler.mm — "
        "the expected text was not found. See the note above; this guard stops "
        "a message queued before teardown reaching a destroyed IWebView.")
    endif()
    file(WRITE "${_handler}" "${_h}")
    message(STATUS "packages/vst3: patched iPlug2 script message handler (null IWebView guard)")
  endif()
endif()
