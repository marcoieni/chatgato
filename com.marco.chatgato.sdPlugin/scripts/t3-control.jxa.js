/* global ObjC, $, Ref, Application, delay */
/* exported run */
// Run by macOS JavaScript for Automation, not Node. Native AX reads preserve
// Electron's URL values and element references, which System Events cannot.
ObjC.import("AppKit");
ObjC.import("ApplicationServices");
ObjC.import("CoreGraphics");
ObjC.bindFunction("AXUIElementCreateApplication", ["id", ["int"]]);
ObjC.bindFunction("AXUIElementCopyAttributeValue", [
  "int",
  ["id", "id", "id*"],
]);
ObjC.bindFunction("AXUIElementSetAttributeValue", ["int", ["id", "id", "id"]]);
ObjC.bindFunction("AXUIElementSetMessagingTimeout", ["int", ["id", "float"]]);
ObjC.bindFunction("AXValueGetValue", ["bool", ["id", "int", "void*"]]);
ObjC.bindFunction("malloc", ["void*", ["int"]]);
ObjC.bindFunction("free", ["void", ["void*"]]);

function pointOrSize(element, name, type) {
  const value = attribute(element, name);
  const buffer = $.malloc(16);
  try {
    if (!value || !$.AXValueGetValue(value, type, buffer)) return null;
    const bytes = new Uint8Array(16);
    for (let i = 0; i < bytes.length; i++) bytes[i] = buffer[i];
    return Array.from(new Float64Array(bytes.buffer));
  } finally {
    $.free(buffer);
  }
}

function attribute(element, name) {
  const result = Ref();
  return $.AXUIElementCopyAttributeValue(element, $(name), result) === 0
    ? result[0]
    : null;
}

function textAttribute(element, name) {
  const value = attribute(element, name);
  return value ? String(ObjC.unwrap(value)) : "";
}

function children(element) {
  const value = attribute(element, "AXChildren");
  if (!value) return [];
  const result = [];
  for (let index = 0; index < value.count; index++)
    result.push(value.objectAtIndex(index));
  return result;
}

function find(root, matches, maxDepth = 8) {
  let level = [root];
  let visited = 0;
  for (let depth = 0; depth < maxDepth; depth++) {
    const next = [];
    for (const element of level) {
      if (++visited > 2000) return null;
      if (matches(element)) return element;
      next.push(...children(element));
    }
    level = next;
  }
  return null;
}

function waitFor(read, message, seconds = 5) {
  const deadline = Date.now() + seconds * 1000;
  do {
    const result = read();
    if (result) return result;
    delay(0.1);
  } while (Date.now() < deadline);
  throw new Error(message);
}

// T3's palette handles pointer selection; AXPress reports success without
// invoking it. Use live accessibility bounds, and restore the pointer afterward.
function clickElement(element, requireFrontmost) {
  const position = pointOrSize(element, "AXPosition", 1);
  const size = pointOrSize(element, "AXSize", 2);
  if (
    !position ||
    !size ||
    size[0] <= 0 ||
    size[1] <= 0 ||
    !position.concat(size).every(Number.isFinite)
  )
    throw new Error("Could not locate the T3 Code chat search result");
  const point = $.CGPointMake(
    position[0] + size[0] / 2,
    position[1] + size[1] / 2,
  );
  requireFrontmost();
  const previousPoint = $.CGEventGetLocation($.CGEventCreate(null));
  const down = $.CGEventCreateMouseEvent(
    null,
    $.kCGEventLeftMouseDown,
    point,
    $.kCGMouseButtonLeft,
  );
  const up = $.CGEventCreateMouseEvent(
    null,
    $.kCGEventLeftMouseUp,
    point,
    $.kCGMouseButtonLeft,
  );
  $.CGEventSetIntegerValueField(down, $.kCGMouseEventClickState, 1);
  $.CGEventSetIntegerValueField(up, $.kCGMouseEventClickState, 1);
  $.CGEventPost($.kCGHIDEventTap, down);
  delay(0.05);
  $.CGEventPost($.kCGHIDEventTap, up);
  $.CGEventPost(
    $.kCGHIDEventTap,
    $.CGEventCreateMouseEvent(
      null,
      $.kCGEventMouseMoved,
      previousPoint,
      $.kCGMouseButtonLeft,
    ),
  );
}

function run(argv) {
  const [threadId, environmentId] = argv;
  if (
    !/^[a-z0-9_-]+$/i.test(threadId || "") ||
    (environmentId && !/^[a-z0-9_-]+$/i.test(environmentId))
  )
    throw new Error("Invalid T3 Code thread identity");

  const bundleId = "com.t3tools.t3code";
  Application(bundleId).activate();
  const runningApp = waitFor(() => {
    const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(
      $(bundleId),
    );
    return apps.count ? apps.objectAtIndex(0) : null;
  }, "T3 Code did not start");
  const pid = runningApp.processIdentifier;
  const app = $.AXUIElementCreateApplication(pid);
  $.AXUIElementSetMessagingTimeout(app, 1);
  $.AXUIElementSetAttributeValue(app, $("AXManualAccessibility"), $(true));

  function requireFrontmost() {
    if (
      $.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier !==
      pid
    )
      throw new Error("T3 Code lost focus during chat navigation");
  }

  const webArea = waitFor(
    () =>
      find(
        app,
        (element) => textAttribute(element, "AXRole") === "AXWebArea",
        12,
      ),
    "Could not find T3 Code's window; check Stream Deck Accessibility permission",
  );

  function routeMatches() {
    const value = attribute(webArea, "AXURL");
    if (!value) return false;
    const url = String(ObjC.unwrap(value.absoluteString));
    const route = url.split("#")[1]?.split("?")[0]?.split("/");
    return (
      route?.[2] === threadId && (!environmentId || route[1] === environmentId)
    );
  }
  if (routeMatches()) return;

  function searchField() {
    return find(
      webArea,
      (element) =>
        textAttribute(element, "AXPlaceholderValue") ===
        "Search commands, projects, and threads...",
      12,
    );
  }
  if (!searchField()) {
    // Move focus out of a terminal before Command-K (!terminalFocus in T3).
    const trigger = find(
      webArea,
      (element) =>
        textAttribute(element, "AXRole") === "AXComboBox" &&
        textAttribute(element, "AXDescription") === "Search threads",
      12,
    );
    if (trigger) {
      clickElement(trigger, requireFrontmost);
      // Let the click move renderer focus out of the terminal before Cmd-K.
      delay(0.2);
    }
    requireFrontmost();
    Application("System Events").keystroke("k", { using: ["command down"] });
  }
  const input = waitFor(
    searchField,
    "T3 Code chat search did not open; check its Command-K keybinding",
  );
  requireFrontmost();
  if ($.AXUIElementSetAttributeValue(input, $("AXValue"), $(threadId)) !== 0)
    throw new Error("Could not enter the thread ID in T3 Code chat search");
  delay(0.6);

  const list = waitFor(() => {
    let parent = attribute(input, "AXParent");
    for (let depth = 0; parent && depth < 4; depth++) {
      const list = find(
        parent,
        (element) =>
          textAttribute(element, "AXRole") === "AXList" &&
          children(element).length > 0,
        4,
      );
      if (list) return list;
      parent = attribute(parent, "AXParent");
    }
    return null;
  }, "T3 Code could not find the requested thread");
  requireFrontmost();
  if (!searchField() || textAttribute(input, "AXValue") !== threadId)
    throw new Error("T3 Code chat search changed before navigation");
  const option = find(
    list,
    (element) => textAttribute(element, "AXSelected") === "true",
    4,
  );
  if (!option) throw new Error("T3 Code chat search has no selectable result");
  clickElement(option, requireFrontmost);
  waitFor(
    routeMatches,
    "T3 Code did not open the requested thread on its environment",
    8,
  );
}
