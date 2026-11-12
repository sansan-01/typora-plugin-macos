#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

static char pendingMenuKey;
static BOOL menuHookInstalled;

@interface PluginMenuAction : NSObject
@property(nonatomic, weak) WKWebView *view;
@property(nonatomic, copy) NSNumber *generation;
@property(nonatomic, copy) NSNumber *index;
+ (void)perform:(NSMenuItem *)item;
@end

@implementation PluginMenuAction
+ (void)perform:(NSMenuItem *)item {
    PluginMenuAction *action = item.representedObject;
    if (![action isKindOfClass:self]) return;
    [action.view evaluateJavaScript:
        [NSString stringWithFormat:@"window.__typoraPluginNativeMenuAction?.(%lld,%lld)",
         action.generation.longLongValue, action.index.longLongValue] completionHandler:nil];
}
@end

static BOOL IsEditor(WKWebView *view) {
    NSString *editor = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"TypeMark/index.html"];
    return view.URL.isFileURL && [view.URL.path.stringByStandardizingPath isEqualToString:editor.stringByStandardizingPath];
}

static void AppendItems(NSMenu *menu, NSArray *entries, WKWebView *view, NSNumber *generation, NSUInteger depth, NSUInteger *remaining) {
    if (depth > 5 || ![entries isKindOfClass:NSArray.class]) return;
    for (NSDictionary *entry in entries) {
        if (!*remaining) break;
        if (![entry isKindOfClass:NSDictionary.class]) continue;
        (*remaining)--;
        if ([entry[@"separator"] isEqual:@YES]) {
            [menu addItem:NSMenuItem.separatorItem];
            continue;
        }
        NSString *title = entry[@"title"];
        if (![title isKindOfClass:NSString.class] || title.length == 0 || title.length > 512) continue;
        NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:NULL keyEquivalent:@""];
        item.state = [entry[@"checked"] isEqual:@YES] ? NSControlStateValueOn : NSControlStateValueOff;
        if ([entry[@"hint"] isKindOfClass:NSString.class]) item.toolTip = entry[@"hint"];
        if ([entry[@"children"] isKindOfClass:NSArray.class]) {
            NSMenu *submenu = [[NSMenu alloc] initWithTitle:title];
            submenu.autoenablesItems = NO;
            AppendItems(submenu, entry[@"children"], view, generation, depth + 1, remaining);
            if (submenu.numberOfItems == 0) continue;
            item.submenu = submenu;
        } else if (![entry[@"enabled"] isEqual:@NO] && [entry[@"id"] isKindOfClass:NSNumber.class]) {
            PluginMenuAction *action = [PluginMenuAction new];
            action.view = view;
            action.generation = generation;
            action.index = entry[@"id"];
            item.target = PluginMenuAction.class;
            item.action = @selector(perform:);
            item.representedObject = action;
        } else {
            item.enabled = NO;
        }
        [menu addItem:item];
    }
}

typedef void (*MenuOpen)(WKWebView *, SEL, NSMenu *, NSEvent *);
static MenuOpen originalMenuOpen;
static void OpenMenu(WKWebView *view, SEL selector, NSMenu *menu, NSEvent *event) {
    originalMenuOpen(view, selector, menu, event);
    NSDictionary *pending = objc_getAssociatedObject(view, &pendingMenuKey);
    objc_setAssociatedObject(view, &pendingMenuKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    if (!pending || !IsEditor(view) || (event.modifierFlags & NSEventModifierFlagOption) ||
        NSProcessInfo.processInfo.systemUptime - [pending[@"time"] doubleValue] > 2) return;

    NSMenu *plugins = [[NSMenu alloc] initWithTitle:@""];
    plugins.autoenablesItems = NO;
    NSUInteger remaining = 512;
    AppendItems(plugins, pending[@"items"], view, pending[@"generation"], 0, &remaining);
    if (!plugins.numberOfItems) return;
    if (menu.numberOfItems && !menu.itemArray.lastObject.isSeparatorItem) [menu addItem:NSMenuItem.separatorItem];
    while (plugins.numberOfItems) {
        NSMenuItem *item = [plugins itemAtIndex:0];
        [plugins removeItemAtIndex:0];
        [menu addItem:item];
    }
}

typedef void (^PromptReply)(NSString *);
typedef void (*PromptHandler)(id, SEL, WKWebView *, NSString *, NSString *, WKFrameInfo *, PromptReply);
static BOOL HandlePrompt(WKWebView *view, NSString *prompt, NSString *text, WKFrameInfo *frame, PromptReply reply) {
    if (!menuHookInstalled || ![prompt isEqualToString:@"__bridge__"] || ![text containsString:@"typoraPluginContext"]) return NO;
    if (!text.length || text.length > 250000) return NO;
    id message = [NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if (![message isKindOfClass:NSDictionary.class] || ![message[@"name"] isEqual:@"typoraPluginContext"] ||
        ![message[@"method"] isEqual:@"setMenu"]) return NO;
    id data = message[@"data"];
    if (!frame.isMainFrame || !IsEditor(view) || ![data isKindOfClass:NSDictionary.class] ||
        ![data[@"generation"] isKindOfClass:NSNumber.class] ||
        ![data[@"items"] isKindOfClass:NSArray.class]) {
        reply(nil);
        return YES;
    }
    objc_setAssociatedObject(view, &pendingMenuKey, @{
        @"generation": data[@"generation"], @"items": data[@"items"],
        @"time": @(NSProcessInfo.processInfo.systemUptime)
    }, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    reply(@"true");
    return YES;
}

static void InstallPromptHook(NSString *className) {
    SEL selector = @selector(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:);
    Method method = class_getInstanceMethod(NSClassFromString(className), selector);
    if (!method || method_getNumberOfArguments(method) != 7) return;
    PromptHandler original = (PromptHandler)method_getImplementation(method);
    IMP hook = imp_implementationWithBlock(^(id receiver, WKWebView *view, NSString *prompt, NSString *text, WKFrameInfo *frame, PromptReply reply) {
        if (!HandlePrompt(view, prompt, text, frame, reply)) original(receiver, selector, view, prompt, text, frame, reply);
    });
    method_setImplementation(method, hook);
}

__attribute__((constructor))
static void InstallNativeContextMenu(void) {
    unsetenv("DYLD_INSERT_LIBRARIES");
    @autoreleasepool {
        Method method = class_getInstanceMethod(NSClassFromString(@"DocWebView"), NSSelectorFromString(@"willOpenMenu:withEvent:"));
        if (!method || method_getNumberOfArguments(method) != 4) return;
        originalMenuOpen = (MenuOpen)method_getImplementation(method);
        method_setImplementation(method, (IMP)OpenMenu);
        menuHookInstalled = YES;
        InstallPromptHook(@"WKWebViewWindowController");
        InstallPromptHook(@"CommandBridge");
    }
}
