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

  it("renders a compact chat card led by the chat title", () => {
    const thread = {
      title: "Redesign the chats button",
      cwd: "/Users/marco/me/proj/chatgato",
    };
    const svg = agentSvg(4, "working", thread);

    expect(svg).toContain(
      '<rect width="144" height="144" rx="24" fill="#071018"/>',
    );
    expect(svg).toContain(
      '<rect x="12" y="12" width="120" height="36" rx="12" fill="#FFFFFF" opacity=".07"/>',
    );
    expect(svg).toContain('data-lucide-icon="loader-circle"');
    expect(svg).toContain(
      'data-working-spinner="true" transform="rotate(0 28 30)"',
    );
    expect(svg).toContain('stroke="#304FFE"');
    expect(svg).toContain('font-weight="800" font-size="15">4</text>');
    expect(svg).toContain(
      'fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-weight="800" font-size="13" text-anchor="end">chatgato</text>',
    );
    expect(svg).toContain('font-size="21"');
    expect(svg).toContain(">Redesign the</text>");
    expect(svg).toContain(">chats button</text>");
    expect(svg).toContain('textLength="116" lengthAdjust="spacingAndGlyphs"');
    expect(svg).not.toContain(">#4</text>");
    expect(svg).not.toContain(">WORKING</text>");
    expect(svg).not.toContain(
      '<rect x="28" y="14" width="88" height="80" rx="22"',
    );
  });

  it("keeps representative project names readable without squeezing them", () => {
    const svg = agentSvg(2, "unread", {
      title: "Explain release",
      cwd: "/Users/marco/me/proj/release-plz",
    });

    expect(svg).toContain(
      '<text x="128" y="35" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-weight="800" font-size="13" text-anchor="end">release-plz</text>',
    );
    expect(svg).not.toContain('textLength="72"');
  });

  it("truncates and XML-escapes chat metadata safely", () => {
    const svg = agentSvg(12, "unread", {
      title: "Investigate <unsafe> & unusuallylongwordwithoutspaces",
      cwd: "/tmp/a-project-name-that-is-too-long",
    });

    expect(svg).toContain('font-size="15">12</text>');
    expect(svg).toContain(">a-project…</text>");
    expect(svg).toContain("&lt;unsafe&gt;");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("…</text>");
    expect(svg).not.toContain("<unsafe>");
  });

  it("uses colored state symbols instead of status labels", () => {
    const expectedIcons = {
      off: "power",
      working: "loader-circle",
      "awaiting-approval": "shield-check",
      "awaiting-response": "message-circle-question-mark",
      error: "x",
    } as const;

    for (const [status, icon] of Object.entries(expectedIcons)) {
      const svg = agentSvg(1, status as keyof typeof expectedIcons);
      expect(svg).toContain(`data-lucide-icon="${icon}"`);
      expect(svg).toContain(
        `stroke="${STATUS_COLORS[status as keyof typeof expectedIcons]}"`,
      );
    }

    const doneSvg = agentSvg(1, "unread");
    expect(doneSvg).toContain(
      '<circle data-agent-status-icon="done" cx="28" cy="30" r="8" fill="#00FF4C"/>',
    );
    expect(doneSvg).not.toContain('data-lucide-icon="circle"');

    const idleSvg = agentSvg(1, "idle");
    expect(idleSvg).not.toContain("data-agent-status-icon");
    expect(idleSvg).not.toContain("data-lucide-icon");
    expect(idleSvg).toContain('<text x="20" y="35"');

    const formerLabels = {
      off: "OFF",
      working: "WORKING",
      unread: "DONE",
      idle: "IDLE",
      "awaiting-approval": "APPROVE",
      "awaiting-response": "INPUT",
      error: "ERROR",
    } as const;
    for (const [status, label] of Object.entries(formerLabels)) {
      expect(agentSvg(1, status as keyof typeof formerLabels)).not.toContain(
        `>${label}</text>`,
      );
    }
  });

  it("renders distinct working-spinner rotation frames", () => {
    const thread = { title: "Chat", cwd: "/tmp/project" };
    const firstFrame = agentSvg(1, "working", thread, 0);
    const nextFrame = agentSvg(1, "working", thread, 45);

    expect(nextFrame).toContain('transform="rotate(45 28 30)"');
    expect(nextFrame).not.toBe(firstFrame);
    expect(agentImage(1, "working", thread, 45)).not.toBe(
      agentImage(1, "working", thread, 0),
    );
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
    const thread = { title: "Chat", cwd: "/tmp/project" };
    const image = agentImage(2, "unread", thread);
    expect(image).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(image.split(",")[1]!, "base64").toString()).toBe(
      agentSvg(2, "unread", thread),
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

  it("clears unread after the matching chat is acknowledged", () => {
    const thread: CodexThread = {
      id: "thread-1",
      title: "Chat",
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
    expect(agentSvg(1, "working", thread)).toContain(
      'font-size="13" text-anchor="end">work</text>',
    );
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
