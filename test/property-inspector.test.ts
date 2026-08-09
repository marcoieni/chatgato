import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const propertyInspector = readFileSync(
  new URL("../com.marco.chatgato.sdPlugin/ui/pi.js", import.meta.url),
  "utf8",
);
const propertyInspectorStyles = readFileSync(
  new URL("../com.marco.chatgato.sdPlugin/ui/pi.css", import.meta.url),
  "utf8",
);

describe("Property Inspector compliance", () => {
  it("marks numeric and workspace fields for inline validation", () => {
    expect(propertyInspector).toContain('data-validation="workspace-path"');
    expect(propertyInspector).toContain("function validateForm()");
    expect(propertyInspector).toContain('setAttribute("aria-invalid"');
    expect(propertyInspector).toContain('setAttribute("aria-live", "polite")');
    expect(propertyInspectorStyles).toContain(".validation-error");
    expect(propertyInspectorStyles).toContain('input[aria-invalid="true"]');
  });

  it("does not auto-save an invalid form", () => {
    expect(propertyInspector).toContain("if (!validateForm()) return;");
  });

  it("links required shortcut instructions to the setup guide", () => {
    expect(propertyInspector).toContain(
      "https://github.com/marcoieni/chatgato#required-keyboard-shortcut-setup",
    );
    expect(propertyInspector).toContain('class="support-link"');
    expect(propertyInspector).toContain('target="_blank"');
    expect(propertyInspector).toContain('event: "openUrl"');
  });
});
