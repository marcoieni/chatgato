import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appleScript = readFileSync(
  new URL(
    "../com.marco.chatgato.sdPlugin/scripts/codex-control.applescript",
    import.meta.url,
  ),
  "utf8",
);
const powerShell = readFileSync(
  new URL(
    "../com.marco.chatgato.sdPlugin/scripts/codex-control.ps1",
    import.meta.url,
  ),
  "utf8",
);

describe("Codex control scripts", () => {
  it("implements the approval shortcuts on macOS", () => {
    expect(appleScript).toMatch(/payload is "approve" then\s+key code 36/u);
    expect(appleScript).toMatch(/payload is "decline" then\s+key code 53/u);
  });

  it("implements the approval shortcuts on Windows", () => {
    expect(powerShell).toContain('approve = "{ENTER}"');
    expect(powerShell).toContain('decline = "{ESC}"');
  });

  it("keeps the Windows terminal shortcut backtick literal", () => {
    expect(powerShell).toContain("terminal = '^`'");
  });

  it("selects an exact reasoning option through the supported slash picker on macOS", () => {
    expect(appleScript).toMatch(/controlMode is "reasoning"/u);
    expect(appleScript).toContain('keystroke "/reasoning"');
    expect(appleScript).toMatch(
      /key code 115\s+repeat optionIndex times\s+key code 125/u,
    );
  });

  it("selects an exact reasoning option through the supported slash picker on Windows", () => {
    expect(powerShell).toContain('$Mode -eq "reasoning"');
    expect(powerShell).toContain('$shell.SendKeys("/reasoning")');
    expect(powerShell).toContain('$shell.SendKeys("{HOME}")');
    expect(powerShell).toContain('$shell.SendKeys("{DOWN}")');
  });

  it("enters Plan through /plan and exits at the start of the composer", () => {
    expect(appleScript).toContain('my toggleSlashMode("/plan")');
    expect(appleScript).toContain('description of childElement is "Plan"');
    expect(appleScript).toContain('payload is "planToggle"');
    expect(appleScript).toMatch(
      /on exitPlanMode\(\)[\s\S]*key code 126 using \{command down\}[\s\S]*AXSelectedTextRange[\s\S]*key code 51[\s\S]*Codex draft changed while disabling Plan mode/u,
    );
    expect(appleScript).toMatch(
      /payload is "planOff" then[\s\S]*my exitPlanMode\(\)[\s\S]*my waitForPlanMode\(false\)/u,
    );
    expect(powerShell).toContain('Invoke-SlashModeToggle "/plan"');
    expect(powerShell).toMatch(
      /function Exit-PlanMode[\s\S]*\$shell\.SendKeys\("\^\{HOME\}"\)[\s\S]*\$shell\.SendKeys\("\{BACKSPACE\}"\)/u,
    );
  });

  it("runs Fast mode in an empty composer and restores the draft on macOS", () => {
    expect(appleScript).toMatch(
      /keystroke "a" using \{command down\}\s+keystroke "x" using \{command down\}/u,
    );
    expect(appleScript).toContain('my toggleSlashMode("/fast")');
    expect(appleScript).toContain("keystroke modeCommand");
    expect(appleScript).toMatch(
      /on enterModeCommand\(modeCommand\)\s+repeat 3 times/u,
    );
    expect(appleScript).toContain(
      "set modeCommandStillPresent to my elementValue(composerElement) is modeCommand",
    );
    expect(appleScript).toContain(
      'error "Codex mode command was not submitted"',
    );
    expect(appleScript).toContain(
      "setString:draftText forType:(current application's NSPasteboardTypeString)",
    );
    expect(appleScript).toContain(
      "copiedItem's setData:itemData forType:itemType",
    );
    expect(appleScript).toContain(
      "my restorePasteboardItems(pasteboard, savedItems)",
    );
    expect(appleScript).toContain(
      'set focusedElement to value of attribute "AXFocusedUIElement"',
    );
    expect(appleScript).toContain("repeat with candidateWindow in windows");
    expect(appleScript).toContain('perform action "AXRaise" of appWindow');
    expect(appleScript).toContain(
      "repeat with descendant in entire contents of candidateParent",
    );
    expect(appleScript).toMatch(
      /my focusElement\(composerElement\)\s+delay 0\.05\s+tell application "System Events"\s+keystroke "a" using \{command down\}\s+keystroke "v" using \{command down\}/u,
    );
    expect(appleScript).toContain(
      "set composerElement to my restoreDraft(pasteboard, draftText, clipboardMarker, composerElement)",
    );
    expect(appleScript).toMatch(
      /on error errorMessage number errorNumber\s+try\s+set composerElement to my restoreDraft/u,
    );
  });

  it("runs Fast mode in an empty composer and restores the draft on Windows", () => {
    expect(powerShell).toContain('$shell.SendKeys("^a")');
    expect(powerShell).toContain('$shell.SendKeys("^x")');
    expect(powerShell).toContain('Invoke-SlashModeToggle "/fast"');
    expect(powerShell).toContain("$shell.SendKeys($ModeCommand)");
    expect(powerShell).toContain('$shell.SendKeys("^v")');
    expect(powerShell).toContain(
      "[System.Windows.Forms.Clipboard]::SetDataObject($savedClipboard, $true)",
    );
  });
});
