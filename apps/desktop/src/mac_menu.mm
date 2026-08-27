#include "mac_menu.h"

#ifdef __APPLE__

#import <Cocoa/Cocoa.h>

namespace openaxe_desktop {

namespace {

// Adds one item to `menu`, wired to `action` on the first responder (nil
// target). That indirection is the whole point of the Edit menu: AppKit
// dispatches copy:/paste:/undo: to whatever view currently has focus, which
// for us is the WKWebView, so the shortcuts reach the web content without any
// bridge of our own.
NSMenuItem* AddItem(NSMenu* menu, NSString* title, SEL action, NSString* key,
                    NSEventModifierFlags modifiers = NSEventModifierFlagCommand) {
  NSMenuItem* item = [[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:key];
  [item setKeyEquivalentModifierMask:modifiers];
  [menu addItem:item];
  return item;
}

NSMenu* BuildAppMenu(NSString* app_name) {
  NSMenu* menu = [[NSMenu alloc] initWithTitle:app_name];

  AddItem(menu, [@"About " stringByAppendingString:app_name],
          @selector(orderFrontStandardAboutPanel:), @"");
  [menu addItem:[NSMenuItem separatorItem]];

  AddItem(menu, [@"Hide " stringByAppendingString:app_name], @selector(hide:), @"h");
  AddItem(menu, @"Hide Others", @selector(hideOtherApplications:), @"h",
          NSEventModifierFlagCommand | NSEventModifierFlagOption);
  AddItem(menu, @"Show All", @selector(unhideAllApplications:), @"");
  [menu addItem:[NSMenuItem separatorItem]];

  // The item that makes Cmd+Q work. terminate: also lets the app quit when the
  // window has been closed, which webview.h's
  // applicationShouldTerminateAfterLastWindowClosed: = NO otherwise makes
  // impossible (issue #300 H2).
  AddItem(menu, [@"Quit " stringByAppendingString:app_name], @selector(terminate:), @"q");
  return menu;
}

NSMenu* BuildEditMenu() {
  NSMenu* menu = [[NSMenu alloc] initWithTitle:@"Edit"];
  AddItem(menu, @"Undo", @selector(undo:), @"z");
  AddItem(menu, @"Redo", @selector(redo:), @"z",
          NSEventModifierFlagCommand | NSEventModifierFlagShift);
  [menu addItem:[NSMenuItem separatorItem]];
  AddItem(menu, @"Cut", @selector(cut:), @"x");
  AddItem(menu, @"Copy", @selector(copy:), @"c");
  AddItem(menu, @"Paste", @selector(paste:), @"v");
  AddItem(menu, @"Select All", @selector(selectAll:), @"a");
  return menu;
}

NSMenu* BuildWindowMenu() {
  NSMenu* menu = [[NSMenu alloc] initWithTitle:@"Window"];
  AddItem(menu, @"Minimize", @selector(performMiniaturize:), @"m");
  AddItem(menu, @"Zoom", @selector(performZoom:), @"");
  [menu addItem:[NSMenuItem separatorItem]];
  // Cmd+W closes the window. With a Quit item present this is no longer a
  // dead end: the process stays alive (webview.h's delegate says not to
  // terminate on last window close) but Cmd+Q can still end it.
  AddItem(menu, @"Close Window", @selector(performClose:), @"w");
  [menu addItem:[NSMenuItem separatorItem]];
  AddItem(menu, @"Bring All to Front", @selector(arrangeInFront:), @"");
  return menu;
}

void AttachSubmenu(NSMenu* main_menu, NSMenu* submenu) {
  NSMenuItem* holder = [[NSMenuItem alloc] initWithTitle:[submenu title]
                                                 action:nil
                                          keyEquivalent:@""];
  [holder setSubmenu:submenu];
  [main_menu addItem:holder];
}

}  // namespace

void InstallMainMenu(const char* app_name) {
  NSString* name = app_name && *app_name ? [NSString stringWithUTF8String:app_name] : @"OpenAxe";

  // NSApplication has to exist before it can own a menu. webview.h creates it
  // in its constructor, so callers must install the menu after constructing
  // the webview and before run().
  NSApplication* app = [NSApplication sharedApplication];
  if (app == nil) return;

  NSMenu* main_menu = [[NSMenu alloc] initWithTitle:@""];
  AttachSubmenu(main_menu, BuildAppMenu(name));
  NSMenu* edit_menu = BuildEditMenu();
  AttachSubmenu(main_menu, edit_menu);
  NSMenu* window_menu = BuildWindowMenu();
  AttachSubmenu(main_menu, window_menu);

  [app setMainMenu:main_menu];
  // Tells AppKit which submenu owns the standard window list, so the Window
  // menu gets the usual list of open windows appended automatically.
  [app setWindowsMenu:window_menu];
}

}  // namespace openaxe_desktop

#else

namespace openaxe_desktop {
void InstallMainMenu(const char*) {}
}  // namespace openaxe_desktop

#endif
