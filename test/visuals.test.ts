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
  usageStatisticsSvg,
  usageSvg,
} from "../src/lib/visuals.js";
import type {
  CodexAccountUsageSnapshot,
  CodexThread,
  CodexUsageSnapshot,
} from "../src/types.js";

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

  it("renders a compact chat card led by the project title", () => {
    const thread = {
      title: "Redesign the chats button",
      cwd: "/Users/marco/me/proj/chatgato",
    };
    const svg = agentSvg(4, "working", thread);

    expect(svg).toContain(
      '<rect width="144" height="144" rx="24" fill="#071018"/>',
    );
    expect(svg).toContain(
      '<rect x="12" y="12" width="120" height="52" rx="12" fill="#FFFFFF" opacity=".08"/>',
    );
    expect(svg).toContain('data-lucide-icon="circle-dashed"');
    expect(svg).not.toContain("data-working-spinner");
    expect(svg).not.toContain('transform="rotate(');
    expect(svg).toContain('stroke="#304FFE"');
    expect(svg).toContain(
      'font-weight="800" font-size="13" text-anchor="end">4</text>',
    );
    expect(svg).toContain(
      'x="72" y="56" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-weight="850" font-size="20" text-anchor="middle">chatgato</text>',
    );
    expect(svg).toContain('font-size="17"');
    expect(svg).toContain('fill-opacity=".84"');
    expect(svg).toContain(
      'x="36" y="31" fill="#304FFE" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-weight="800" font-size="11" letter-spacing=".3">WORKING</text>',
    );
    expect(svg).toContain(">Redesign the</text>");
    expect(svg).toContain(">chats button</text>");
    expect(svg).not.toContain(">#4</text>");
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
      '<text x="72" y="56" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-weight="850" font-size="20" text-anchor="middle">release-plz</text>',
    );
    expect(svg).not.toContain('textLength="112"');
  });

  it("truncates and XML-escapes chat metadata safely", () => {
    const svg = agentSvg(12, "unread", {
      title: "Investigate <unsafe> & unusuallylongwordwithoutspaces",
      cwd: "/tmp/a-project-name-that-is-too-long",
    });

    expect(svg).toContain('font-size="13" text-anchor="end">12</text>');
    expect(svg).toContain(">a-project…</text>");
    expect(svg).toContain("&lt;unsafe&gt;");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("…</text>");
    expect(svg).not.toContain("<unsafe>");
  });

  it("truncates very long chat titles without blocking rendering", () => {
    const startedAt = performance.now();
    const svg = agentSvg(1, "working", {
      title: "x".repeat(20_000),
      cwd: "/tmp/project",
    });

    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(svg).toMatch(/>x+…<\/text>/u);
  });

  it("uses matching state symbols and compact status labels", () => {
    const expectedIcons = {
      off: "power",
      working: "circle-dashed",
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
      '<circle data-agent-status-icon="done" cx="24" cy="27" r="6" fill="#00FF4C"/>',
    );
    expect(doneSvg).not.toContain('data-lucide-icon="circle"');

    const idleSvg = agentSvg(1, "idle");
    expect(idleSvg).not.toContain("data-agent-status-icon");
    expect(idleSvg).not.toContain("data-lucide-icon");
    expect(idleSvg).not.toContain('letter-spacing=".3"');
    expect(idleSvg).not.toContain(">IDLE</text>");
    expect(idleSvg).toContain(
      '<text x="124" y="31" fill="#FFFFFF" fill-opacity=".72"',
    );

    const labels = {
      off: "OFF",
      working: "WORKING",
      unread: "DONE",
      "awaiting-approval": "APPROVAL",
      "awaiting-response": "INPUT",
      error: "ERROR",
    } as const;
    for (const [status, label] of Object.entries(labels)) {
      expect(agentSvg(1, status as keyof typeof labels)).toContain(
        `letter-spacing=".3">${label}</text>`,
      );
    }
    expect(agentSvg(1, "off")).toContain('fill="#9AA6B2"');
  });

  it("renders one thin progress segment per subtask inside the existing header", () => {
    const svg = agentSvg(1, "working", {
      title: "Coordinate the implementation",
      cwd: "/tmp/project",
      subtaskStatuses: ["working", "awaiting-response", "unread", "error"],
    });

    expect(svg).toContain('data-subtask-progress="true"');
    expect(svg.match(/data-subtask-status=/gu)).toHaveLength(4);
    expect(svg).toContain(
      'data-subtask-status="unread" x="18.00" y="14" width="25.88" height="4" fill="#00FF4C" opacity="1"',
    );
    expect(svg).toContain(
      'data-subtask-status="working" x="45.38" y="14" width="25.88" height="4" fill="#304FFE" opacity="1"',
    );
    expect(svg).toContain('fill="#9E5BFF" opacity="0.3"');
    expect(svg).toContain('fill="#FF0033" opacity="1"');
    expect(svg).toContain(
      '<rect x="12" y="12" width="120" height="52" rx="12" fill="#FFFFFF" opacity=".08"/>',
    );
  });

  it("fills completed subtask progress from left to right", () => {
    const svg = agentSvg(1, "working", {
      title: "Coordinate the implementation",
      cwd: "/tmp/project",
      subtaskStatuses: ["working", "unread", "idle", "unread"],
    });

    expect(
      [...svg.matchAll(/data-subtask-status="([^"]+)"/gu)].map(
        ([, status]) => status,
      ),
    ).toEqual(["unread", "unread", "working", "idle"]);
  });

  it("does not reserve progress-bar space for chats without subtasks", () => {
    expect(
      agentSvg(1, "idle", { title: "Regular chat", cwd: "/tmp/project" }),
    ).not.toContain('data-subtask-progress="true"');
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
      expect(svg).toContain("Icons: Lucide v1.37.0, ISC license.");
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
      'font-size="20" text-anchor="middle">work</text>',
    );
  });

  it("renders remaining usage for both rate-limit windows", () => {
    const usage: CodexUsageSnapshot = {
      updatedAtMs: 1,
      primary: { usedPercent: 18, windowMinutes: 300, resetsAtMs: null },
      secondary: { usedPercent: 61, windowMinutes: 10_080, resetsAtMs: null },
      planType: "pro",
      rateLimitReachedType: null,
      resetCredits: null,
      credits: null,
    };
    const svg = usageSvg(usage);
    expect(svg).toContain(">5H</text>");
    expect(svg).toContain(">82%</text>");
    expect(svg).toContain(">1W</text>");
    expect(svg).toContain(">39%</text>");
    expect(svg).toContain('font-size="18">5H</text>');
    expect(svg).toContain('font-size="28" text-anchor="end">82%</text>');
  });

  it("renders reset countdowns, reached reason, and earned reset credits", () => {
    const now = Date.parse("2026-08-30T10:00:00.000Z");
    const usage: CodexUsageSnapshot = {
      updatedAtMs: now,
      primary: {
        usedPercent: 100,
        windowMinutes: 300,
        resetsAtMs: now + 2 * 3_600_000 + 14 * 60_000,
      },
      secondary: null,
      planType: "pro",
      rateLimitReachedType: "workspace_member_usage_limit_reached",
      resetCredits: { availableCount: 2, credits: null },
      credits: null,
    };

    const svg = usageSvg(usage, false, now);
    expect(svg).toContain(">RESET 2H 14M</text>");
    expect(svg).toContain('data-usage-badge="USAGE CAP"');
    expect(svg).toContain('data-usage-badge="RESET ×2"');
  });

  it("renders account token statistics and seven daily bars", () => {
    const usage: CodexAccountUsageSnapshot = {
      updatedAtMs: 1,
      summary: {
        lifetimeTokens: 12_400_000,
        peakDailyTokens: 482_000,
        longestRunningTurnSeconds: 3_900,
        currentStreakDays: 7,
        longestStreakDays: 21,
      },
      dailyUsageBuckets: [
        { startDate: "2026-08-28", tokens: 90_000 },
        { startDate: "2026-08-29", tokens: 120_000 },
        { startDate: "2026-08-30", tokens: 100_000 },
      ],
    };

    const svg = usageStatisticsSvg(usage);
    expect(svg).toContain(">12.4M</text>");
    expect(svg).toContain(">PEAK 482K</text>");
    expect(svg).toContain(">STREAK 7/21D</text>");
    expect(svg).toContain(">TURN 1H 5M</text>");
    expect(svg.match(/data-daily-tokens=/gu)).toHaveLength(7);
  });
});
