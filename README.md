# ChatGato

<p align="center">
  <img src="logo.png" alt="ChatGato logo" width="240">
</p>

A Stream Deck plugin for OpenAI Codex in the ChatGPT desktop app. It turns a standard Stream Deck into a tactile Codex control surface and adds native dial behavior on Stream Deck+.

> [!NOTE]
> This app was vibe-coded: the maintainer didn't read all its code.

## Features

| Capability | Stream Deck implementation |
| --- | --- |
| 20 live Agent Keys | 20 configurable **Agent Status** actions read local Codex task state, show the task's project, and open it on press. |
| Live RGB status | Key backgrounds show working `#304FFE`, completed/unread `#00FF4C`, approval `#FF6D00`, needs response `#9E5BFF`, error `#FF0033`, and idle white. |
| Usage limits | **Usage Limits** shows the percentage left in Codex's current rate-limit windows and refreshes from local Codex task data. |
| Skill joystick | **Workflow** launches PR review, debug, refactor, tests, security, docs, custom prompts, or any installed `$skill`. |
| Accept / reject | Dedicated **Allow** and **Decline** actions expose Codex's context-sensitive shortcuts. |
| Dictation controls | Hold the dedicated **Push to Talk** key, or press **Tap to Talk** once to start dictation and again to stop. Active microphone keys turn yellow. |
| Fast mode | A dedicated **Fast Mode** key toggles `/fast`, showing gray while off and green while on. |
| New task and navigation | Dedicated New Task, Go Back, Go Forward, and Toggle Sidebar actions complement task search and previous/next task controls. |
| Reasoning dial | A Stream Deck+ encoder raises/lowers reasoning effort; the same action works as an increase/decrease key on standard decks. |
| Dedicated core actions | Separate Submit, Fork, Review Tab, Toggle Terminal, Review, Settings, Plan, Skills, Scheduled, Go Back, Go Forward, and Toggle Sidebar actions are ready to drag directly onto keys. |
| More commands | Browser, environment action, commit, pull request, attachments, copy Markdown, archive, pin, feedback, and side chat remain available through Codex Command. |

The ChatGPT desktop app exposes Codex deep links and keyboard shortcuts, but not a public external command API. Commands without a documented shortcut are therefore invoked through the app's Command Menu. This is configurable for localized command names.

## Requirements

- Stream Deck 7.1 or newer
- macOS 13+ or Windows 10+
- The ChatGPT desktop app with Codex enabled
- A Stream Deck device; Stream Deck+ is optional for dial control

The plugin uses Stream Deck's bundled Node.js 24 runtime. No API key or network service is required.
ChatGato reads local Codex state and uses operating-system automation to control the ChatGPT desktop
app.

## Build and install for development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run validate
npm run link
```

After linking, drag actions from that category onto keys or a Stream Deck+ dial.

On macOS, keyboard-driven actions such as Submit, Fork, Review Tab, Toggle Terminal, Review, Allow, Decline, Push to Talk, Tap to Talk, Command, and Reasoning may prompt for Accessibility permission. Agent Status and deep-link actions do not require Accessibility permission.

If a command key shows a warning triangle, check
`com.marco.chatgato.sdPlugin/logs/com.marco.chatgato.0.log`. Command failures include
the selected command and the operating-system automation error.

To create a distributable plugin:

```bash
npm run pack
```

## Suggested 15-key layout

| Row | Keys |
| --- | --- |
| 1 | Agent 1 · Agent 2 · Agent 3 · Agent 4 · Agent 5 |
| 2 | Agent 6 · Allow · Decline · Push to talk · New task |
| 3 | Workflow · Fast mode · Review · Usage Limits · Reasoning |

For each Agent Status key, choose a different slot from 1–20. Optionally set an absolute workspace path to filter the keys to one project.

## How live status works

The plugin reads Codex's `state_5.sqlite` from `sqlite_home` in
`$CODEX_HOME/config.toml` when configured, then `CODEX_SQLITE_HOME`, and otherwise
`CODEX_HOME` (normally `~/.codex`). Relative SQLite locations resolve from the
plugin's current working directory. Rollout files and `models_cache.json` remain
under `CODEX_HOME`. See the official
[Codex environment-variable documentation](https://learn.chatgpt.com/docs/config-file/environment-variables).

This is an integration with Codex's internal, version-sensitive SQLite schema,
not a public or stable state API. Codex releases may change the database filename,
tables, columns, or rollout event format and require a corresponding plugin update.
The plugin does not transmit task titles, paths, prompts, or status anywhere.
Status changes are polled every two seconds by default.

Completion is shown as green/unread. Pressing that Agent key acknowledges the completion and opens the task, changing the key to idle white until the task updates again.

The Usage Limits key reads the latest rate-limit snapshot that Codex writes to local task rollouts. It displays remaining allowance rather than consumed allowance; for example, a Codex `used_percent` value of 18 is shown as 82% left. Press the key to refresh immediately. The snapshot advances when Codex reports usage during a task, so it can remain unchanged while Codex is idle.

## Notes and limitations

- ChatGato is an independent Stream Deck plugin and is not affiliated with or endorsed by OpenAI or Elgato.
- Auto-submit is off by default. With it off, deep-linked prompts are placed in the composer for review, matching Codex's documented behavior.
- Command Menu labels can vary by app language or release. Use **Menu query** in the property inspector when a palette command does not resolve.
- Agent status is inferred from internal local Codex state and rollout events. It intentionally avoids private app IPC and cloud APIs.
- Usage limits are also read locally from Codex rollout events; no account credentials or usage data are transmitted by the plugin.
- The plugin controls Codex in the current ChatGPT window. If another ChatGPT window is active, Command Menu operations act on whichever window becomes primary.

References: [Codex desktop commands and deep links](https://developers.openai.com/codex/app/commands) and the [Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk/).

## Why this name?

The name **ChatGato** combines both:

* the words for “cat” in French (`chat`), and Spanish (`gato`).
* the words ChatGPT and Elgato, the makers of the Stream Deck.
