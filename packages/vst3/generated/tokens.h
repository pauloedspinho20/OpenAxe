// GENERATED FILE - do not edit by hand.
// Produced by packages/ui/scripts/generate-tokens.mjs from packages/ui/tokens/design-tokens.json
// Design tokens for C++ (IControl / IGraphics) — optional target. Primary target is CSS for React.
#pragma once

#include "IPlug_include_in_plug_hdr.h"

namespace openaxe::tokens {

// ── Colors ─────────────────────────────────────────────────────────
namespace color {
namespace dark {
  inline constexpr IColor chassis = IColor(255, 16, 16, 16);
  inline constexpr IColor panel = IColor(255, 26, 26, 26);
  inline constexpr IColor panelRaised = IColor(255, 33, 33, 33);
  inline constexpr IColor panelRecessed = IColor(255, 23, 22, 19);
  inline constexpr IColor seam = IColor(15, 255, 255, 255);
  inline constexpr IColor seamStrong = IColor(31, 255, 255, 255);
  inline constexpr IColor highlight = IColor(10, 255, 255, 255);
  inline constexpr IColor ink1 = IColor(255, 238, 236, 230);
  inline constexpr IColor ink2 = IColor(255, 143, 141, 134);
  inline constexpr IColor ink3 = IColor(255, 87, 86, 79);
  inline constexpr IColor inkReverse1 = IColor(255, 255, 255, 255);
  inline constexpr IColor inkReverse2 = IColor(191, 255, 255, 255);
  inline constexpr IColor inkReverse3 = IColor(140, 255, 255, 255);
  inline constexpr IColor shadowAmbient = IColor(128, 0, 0, 0);
  inline constexpr IColor shadowDeep = IColor(179, 0, 0, 0);
  inline constexpr IColor shadowSoft = IColor(153, 0, 0, 0);
} // namespace dark
namespace light {
  inline constexpr IColor chassis = IColor(255, 231, 226, 214);
  inline constexpr IColor panel = IColor(255, 239, 234, 224);
  inline constexpr IColor panelRaised = IColor(255, 247, 243, 234);
  inline constexpr IColor panelRecessed = IColor(255, 217, 211, 196);
  inline constexpr IColor seam = IColor(20, 0, 0, 0);
  inline constexpr IColor seamStrong = IColor(41, 0, 0, 0);
  inline constexpr IColor highlight = IColor(153, 255, 255, 255);
  inline constexpr IColor ink1 = IColor(255, 32, 31, 26);
  inline constexpr IColor ink2 = IColor(255, 107, 106, 98);
  inline constexpr IColor ink3 = IColor(255, 166, 162, 151);
  inline constexpr IColor inkReverse1 = IColor(255, 255, 255, 255);
  inline constexpr IColor inkReverse2 = IColor(191, 255, 255, 255);
  inline constexpr IColor inkReverse3 = IColor(140, 255, 255, 255);
  inline constexpr IColor shadowAmbient = IColor(41, 0, 0, 0);
  inline constexpr IColor shadowDeep = IColor(77, 0, 0, 0);
  inline constexpr IColor shadowSoft = IColor(56, 0, 0, 0);
} // namespace light
namespace shared {
  inline constexpr IColor screenBg = IColor(255, 6, 7, 10);
  inline constexpr IColor screenText = IColor(255, 95, 220, 122);
  inline constexpr IColor screenDim = IColor(255, 58, 63, 56);
  inline constexpr IColor screenWhite = IColor(255, 238, 236, 230);
  inline constexpr IColor accent = IColor(255, 255, 90, 31);
  inline constexpr IColor accentDim = IColor(41, 255, 90, 31);
  inline constexpr IColor accentInk = IColor(255, 26, 9, 0);
  inline constexpr IColor noticeSurface = IColor(26, 255, 90, 31);
  inline constexpr IColor noticeBorder = IColor(77, 255, 90, 31);
  inline constexpr IColor dangerSurface = IColor(31, 255, 59, 48);
  inline constexpr IColor dangerBorder = IColor(102, 255, 59, 48);
  inline constexpr IColor ledOn = IColor(255, 95, 220, 122);
  inline constexpr IColor ledWarn = IColor(255, 255, 176, 32);
  inline constexpr IColor ledHot = IColor(255, 255, 59, 48);
  inline constexpr IColor ledHotBright = IColor(255, 255, 106, 87);
  inline constexpr IColor ledOff = IColor(255, 42, 42, 40);
  inline constexpr IColor meterOff = IColor(255, 32, 31, 29);
  inline constexpr IColor meterGlowGreen = IColor(128, 95, 220, 122);
  inline constexpr IColor meterGlowAmber = IColor(128, 255, 176, 32);
  inline constexpr IColor meterGlowRed = IColor(153, 255, 59, 48);
  inline constexpr IColor overlayBg = IColor(166, 0, 0, 0);
  inline constexpr IColor overlayBgStrong = IColor(184, 0, 0, 0);
  inline constexpr IColor screwLight = IColor(255, 74, 74, 72);
  inline constexpr IColor screwDark = IColor(255, 10, 10, 10);
  inline constexpr IColor screwHighlight = IColor(15, 255, 255, 255);
  inline constexpr IColor faderTrack = IColor(128, 0, 0, 0);
  inline constexpr IColor faderTrackBorder = IColor(10, 255, 255, 255);
  inline constexpr IColor faderThumbTop = IColor(255, 60, 60, 57);
  inline constexpr IColor faderThumbBottom = IColor(255, 32, 31, 29);
  inline constexpr IColor toggleThumbTop = IColor(255, 74, 74, 72);
  inline constexpr IColor toggleThumbBottom = IColor(255, 35, 35, 33);
  inline constexpr IColor btnHoverBorder = IColor(51, 255, 255, 255);
  inline constexpr IColor btnActiveHighlight = IColor(15, 255, 255, 255);
  inline constexpr IColor dangerBgDim = IColor(36, 255, 59, 48);
  inline constexpr IColor dangerGlowDim = IColor(64, 255, 59, 48);
  // blockAmp: rgb(0, 9, 13) (unparsed)
  inline constexpr IColor blockAmpCab = IColor(255, 0, 18, 25);
  inline constexpr IColor blockPedal = IColor(255, 0, 95, 115);
  inline constexpr IColor blockCab = IColor(255, 10, 147, 150);
  inline constexpr IColor blockFilter = IColor(255, 148, 210, 189);
  inline constexpr IColor blockUtility = IColor(255, 233, 216, 166);
  inline constexpr IColor blockDelay = IColor(255, 238, 155, 0);
  inline constexpr IColor blockReverb = IColor(255, 202, 103, 2);
  inline constexpr IColor blockModulation = IColor(255, 187, 62, 3);
  inline constexpr IColor blockCore = IColor(255, 174, 32, 18);
  inline constexpr IColor blockDynamics = IColor(255, 155, 34, 38);
} // namespace shared
} // namespace color

// ── Spacing / radii / sizing ──────────────────────────────────────
namespace spacing {
  inline constexpr float sp1 = 4.0f; // 4px
  inline constexpr float sp2 = 8.0f; // 8px
  inline constexpr float sp3 = 12.0f; // 12px
  inline constexpr float sp4 = 16.0f; // 16px
  inline constexpr float sp5 = 24.0f; // 24px
  inline constexpr float sp6 = 32.0f; // 32px
  inline constexpr float sp7 = 48.0f; // 48px
  inline constexpr float radiusSm = 3.0f; // 3px
  inline constexpr float radiusMd = 6.0f; // 6px
  inline constexpr float radiusLg = 10.0f; // 10px
  inline constexpr float screwSize = 4.0f; // 4px
  inline constexpr float screwOffset = 8.0f; // 8px
  inline constexpr float ledSizeSm = 6.0f; // 6px
  inline constexpr float toggleWidth = 30.0f; // 30px
  inline constexpr float toggleHeight = 16.0f; // 16px
  inline constexpr float toggleThumb = 12.0f; // 12px
  inline constexpr float toggleTravel = 14.0f; // 14px
  inline constexpr float faderTrackHeight = 130.0f; // 130px
  inline constexpr float faderTrackWidth = 28.0f; // 28px
  inline constexpr float faderThumbW = 22.0f; // 22px
  inline constexpr float faderThumbH = 11.0f; // 11px
  inline constexpr float faderThumbOffset = -9.0f; // -9px
  inline constexpr float meterSegmentW = 20.0f; // 20px
  inline constexpr float meterSegmentH = 6.0f; // 6px
  inline constexpr float inputHeight = 32.0f; // 32px
  inline constexpr float jackSize = 12.0f; // 12px
  inline constexpr float jackWrapSize = 14.0f; // 14px
  inline constexpr float jackOffset = -6.0f; // -6px
  inline constexpr float railMinWidth = 80.0f; // 80px
  inline constexpr float gridMinRow = 96.0f; // 96px
  inline constexpr float gridMinCol = 100.0f; // 100px
} // namespace spacing

// ── Container (max-width per breakpoint) ────────────────────────
namespace container {
  inline constexpr float mwXs = 520.0f; // 520px
  inline constexpr float mwSm = 640.0f; // 640px
  inline constexpr float mwMd = 720.0f; // 720px
  inline constexpr float mwLg = 920.0f; // 920px
  inline constexpr float mwXl = 1200.0f; // 1200px
  inline constexpr float mwXxl = 1600.0f; // 1600px
} // namespace container

// ── Typography ─────────────────────────────────────────────────────
namespace typography {
  inline constexpr const char* kFontDisplay = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace";
  inline constexpr const char* kFontBody = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  inline constexpr float kBaseSize = 14.0f;
  inline constexpr float kBaseLineHeight = 1.40f;
} // namespace typography

} // namespace openaxe::tokens
