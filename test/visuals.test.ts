import { describe, expect, it } from "vitest";
import {
  STATUS_COLORS,
  FAST_MODE_COLORS,
  PLAN_MODE_COLORS,
  PUSH_TO_TALK_COLORS,
  agentImage,
  agentSvg,
  effectiveStatus,
  fastModeImage,
  fastModeSvg,
  planModeImage,
  planModeSvg,
  pushToTalkImage,
  pushToTalkSvg,
  reasoningSvg,
  keyTitle,
  usageSvg,
} from "../src/lib/visuals.js";
import type { CodexThread, CodexUsageSnapshot } from "../src/types.js";

describe("Stream Deck visuals", () => {
  it("exposes the ChatGato status colors", () => {
    expect(STATUS_COLORS.working).toBe("#304FFE");
    expect(STATUS_COLORS.unread).toBe("#00FF4C");
    expect(STATUS_COLORS["awaiting-approval"]).toBe("#FF6D00");
    expect(STATUS_COLORS["awaiting-response"]).toBe("#9E5BFF");
    expect(STATUS_COLORS.error).toBe("#FF0033");
    expect(new Set(Object.values(STATUS_COLORS))).toHaveLength(
      Object.keys(STATUS_COLORS).length,
    );
  });

  it("renders the task number over the status color without a terminal icon", () => {
    expect(agentSvg(4, "working")).toContain(
      '<rect width="144" height="144" rx="24" fill="#071018"/>',
    );
    expect(agentSvg(4, "working")).toContain(
      '<rect x="28" y="14" width="88" height="80" rx="22" fill="#304FFE"/>',
    );
    expect(agentSvg(4, "unread")).toContain(
      '<rect x="28" y="14" width="88" height="80" rx="22" fill="#00FF4C"/>',
    );
    expect(agentSvg(4, "working")).toContain(
      '<text x="72" y="72" fill="#FFFFFF" font-family="Arial,sans-serif" font-weight="800" font-size="54" text-anchor="middle">4</text>',
    );
    expect(agentSvg(14, "unread")).toContain(
      '<text x="72" y="72" fill="#071018" font-family="Arial,sans-serif" font-weight="800" font-size="46" text-anchor="middle">14</text>',
    );
    expect(agentSvg(4, "working")).not.toContain("dominant-baseline");
    expect(agentSvg(4, "working")).not.toContain("<path");
    expect(agentSvg(4, "working")).not.toContain("<circle");
  });

  it("highlights the fast-mode shape without changing its background", () => {
    expect(FAST_MODE_COLORS).toEqual({ off: "#303840", on: "#FFD600" });
    expect(fastModeSvg(false)).toContain(
      '<rect x="28" y="14" width="88" height="80" rx="22" fill="#303840"/>',
    );
    expect(fastModeSvg(true)).toContain(
      '<rect x="28" y="14" width="88" height="80" rx="22" fill="#303840"/>',
    );
    expect(fastModeSvg(false)).toContain('data-lucide-icon="zap"');
    expect(fastModeSvg(false)).toContain('stroke="#FFFFFF"');
    expect(fastModeSvg(true)).toContain('stroke="#FFD600"');
    expect(fastModeSvg(false)).not.toBe(fastModeSvg(true));
    expect(fastModeImage(true)).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(
      Buffer.from(fastModeImage(true).split(",")[1]!, "base64").toString(),
    ).toBe(fastModeSvg(true));
  });

  it("keeps every dynamic keypad glyph centered in the accent panel", () => {
    const images = [
      agentSvg(4, "working"),
      fastModeSvg(false),
      fastModeSvg(true),
      planModeSvg(false),
      planModeSvg(true),
      pushToTalkSvg(false),
      pushToTalkSvg(true),
      reasoningSvg("decrease"),
      reasoningSvg("increase"),
    ];

    for (const svg of images) {
      const centeredGroup = svg.match(
        /<g data-source-center="([\d.-]+) ([\d.-]+)" data-glyph-center="([\d.-]+) ([\d.-]+)" transform="translate\(([\d.-]+) ([\d.-]+)\)">/,
      );
      expect(centeredGroup).not.toBeNull();

      const [, sourceX, sourceY, targetX, targetY, offsetX, offsetY] =
        centeredGroup!;
      expect(Number(sourceX) + Number(offsetX)).toBe(Number(targetX));
      expect(Number(sourceY) + Number(offsetY)).toBe(Number(targetY));
      expect([Number(targetX), Number(targetY)]).toEqual([72, 54]);
    }
  });

  it("highlights the plan-mode shape without changing its background", () => {
    expect(PLAN_MODE_COLORS).toEqual({ off: "#303840", on: "#FFD600" });
    expect(PLAN_MODE_COLORS.on).toBe(FAST_MODE_COLORS.on);
    expect(planModeSvg(false)).toContain(
      '<rect x="28" y="14" width="88" height="80" rx="22" fill="#303840"/>',
    );
    expect(planModeSvg(true)).toContain(
      '<rect x="28" y="14" width="88" height="80" rx="22" fill="#303840"/>',
    );
    expect(planModeSvg(false)).toContain('data-lucide-icon="lightbulb"');
    expect(planModeSvg(false)).toContain('stroke="#FFFFFF"');
    expect(planModeSvg(true)).toContain('stroke="#FFD600"');
    expect(planModeSvg(false)).not.toBe(planModeSvg(true));
    expect(
      Buffer.from(planModeImage(true).split(",")[1]!, "base64").toString(),
    ).toBe(planModeSvg(true));
  });

  it("renders a yellow microphone key while push-to-talk is active", () => {
    expect(PUSH_TO_TALK_COLORS).toEqual({ idle: "#303840", active: "#FFD600" });
    expect(pushToTalkSvg(false)).toContain('fill="#303840"');
    expect(pushToTalkSvg(true)).toContain('fill="#FFD600"');
    expect(pushToTalkSvg(false)).toContain('data-lucide-icon="mic"');
    expect(pushToTalkSvg(true)).toContain('stroke="#071018"');
    expect(pushToTalkSvg(false)).not.toBe(pushToTalkSvg(true));
    expect(
      Buffer.from(pushToTalkImage(true).split(",")[1]!, "base64").toString(),
    ).toBe(pushToTalkSvg(true));
  });

  it("encodes generated SVGs as images for Stream Deck", () => {
    const image = agentImage(2, "unread");
    expect(image).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(image.split(",")[1]!, "base64").toString()).toBe(
      agentSvg(2, "unread"),
    );
  });

  it("uses Lucide glyphs for dynamic control icons", () => {
    expect(reasoningSvg("decrease")).toContain('data-lucide-icon="brain"');
    expect(reasoningSvg("decrease")).toContain('data-lucide-icon="arrow-down"');
    expect(reasoningSvg("increase")).toContain('data-lucide-icon="arrow-up"');

    for (const svg of [
      fastModeSvg(false),
      planModeSvg(false),
      pushToTalkSvg(false),
      reasoningSvg("increase"),
    ]) {
      expect(svg).toContain("Icons: Lucide v1.27.0, ISC license.");
    }
  });

  it("clears unread after the matching task is acknowledged", () => {
    const thread: CodexThread = {
      id: "thread-1",
      title: "Task",
      cwd: "/tmp",
      rolloutPath: "/tmp/rollout",
      updatedAtMs: 1000,
      reasoningEffort: null,
      spawnStatus: null,
      status: "unread",
    };
    expect(effectiveStatus(thread, "thread-1", 1000)).toBe("idle");
    expect(effectiveStatus(thread, "another", 2000)).toBe("unread");
  });

  it("shows a Unix SSH project name on every desktop platform", () => {
    const thread: CodexThread = {
      id: "remote-thread",
      title: "Remote",
      cwd: "/home/user/work",
      rolloutPath: "/home/user/.codex/rollout.jsonl",
      updatedAtMs: 1000,
      reasoningEffort: null,
      spawnStatus: null,
      status: "working",
    };
    expect(keyTitle(thread, "working")).toBe("WORKING\nwork");
  });

  it("renders remaining usage for both rate-limit windows", () => {
    const usage: CodexUsageSnapshot = {
      updatedAtMs: 1,
      primary: { usedPercent: 18, windowMinutes: 300, resetsAtMs: null },
      secondary: { usedPercent: 61, windowMinutes: 10_080, resetsAtMs: null },
      planType: "pro",
      credits: null,
    };
    const svg = usageSvg(usage);
    expect(svg).toContain(">5H</text>");
    expect(svg).toContain(">82%</text>");
    expect(svg).toContain(">1W</text>");
    expect(svg).toContain(">39%</text>");
    expect(svg).toContain('font-size="20">5H</text>');
    expect(svg).toContain('font-size="32" text-anchor="end">82%</text>');
  });
});
