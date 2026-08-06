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

  it("sends the configured Fast and Plan shortcuts on macOS", () => {
    expect(appleScript).toMatch(
      /payload is "toggleFastMode" then\s+keystroke "f" using \{command down, option down, shift down\}/u,
    );
    expect(appleScript).toMatch(
      /payload is "togglePlanMode" then\s+keystroke "p" using \{command down, option down, shift down\}/u,
    );
  });

  it("retries transient macOS activation failures", () => {
    expect(appleScript).toMatch(/repeat with attempt from 1 to 3/u);
    expect(appleScript).toContain(
      "my sendControl(controlMode, payload, resultIndex, maxResultIndex)",
    );
    expect(appleScript).toMatch(
      /if errorNumber is not -600 then error errorMessage number errorNumber/u,
    );
    expect(appleScript).toMatch(
      /if attempt is 3 then error errorMessage number errorNumber/u,
    );
  });

  it("sends the configured Fast and Plan shortcuts on Windows", () => {
    expect(powerShell).toContain('toggleFastMode = "^%+f"');
    expect(powerShell).toContain('togglePlanMode = "^%+p"');
  });

  it("opens host-aware task search results on macOS", () => {
    expect(appleScript).toMatch(/controlMode is "thread" then/u);
    expect(appleScript).toContain("resultIndex > maxResultIndex");
    expect(appleScript).toMatch(
      /keystroke "s" using \{command down, option down, shift down\}[\s\S]*keystroke payload[\s\S]*repeat resultIndex times/u,
    );
    expect(appleScript).not.toContain('open location "codex://settings"');
    expect(appleScript).not.toContain("resultIndex > 19");
    expect(appleScript).not.toContain('keystroke "Search Chats"');
    expect(appleScript).not.toContain('keystroke "k" using {command down}');
  });

  it("opens host-aware task search results on Windows", () => {
    expect(powerShell).toContain('if ($Mode -eq "thread")');
    expect(powerShell).toContain("$ResultIndex -gt $MaxResultIndex");
    expect(powerShell).toContain('$shell.SendKeys("^%+s")');
    expect(powerShell).toContain("$shell.SendKeys($escapedQuery)");
    expect(powerShell).not.toContain('Start-Process "codex://settings"');
    expect(powerShell).toMatch(/for \(\$index = 0; \$index -lt \$ResultIndex/u);
    expect(powerShell).not.toContain("$ResultIndex -gt 19");
    expect(powerShell).not.toContain('$shell.SendKeys("Search Chats")');
    expect(powerShell).not.toContain('$shell.SendKeys("^k")');
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
});
