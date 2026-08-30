import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultCodexExecutable(
  platform = process.platform,
  userHome = homedir(),
): string {
  const candidates =
    platform === "darwin"
      ? [
          "/Applications/ChatGPT.app/Contents/Resources/codex",
          join(
            userHome,
            "Applications",
            "ChatGPT.app",
            "Contents",
            "Resources",
            "codex",
          ),
        ]
      : platform === "win32"
        ? windowsCodexCandidates()
        : [];
  return (
    candidates.find((candidate) => existsSync(candidate)) ??
    (platform === "win32" ? "codex.exe" : "codex")
  );
}

function windowsCodexCandidates(): string[] {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return [];
  return [
    join(localAppData, "Programs", "ChatGPT", "resources", "codex.exe"),
    join(localAppData, "Programs", "ChatGPT", "codex.exe"),
  ];
}
