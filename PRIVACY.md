# ChatGato Privacy Policy

Effective date: August 9, 2026

ChatGato is a Stream Deck plugin that controls Codex in the ChatGPT desktop app
and displays information about recent Codex chats. This policy explains what
ChatGato processes and where that data goes.

## Data ChatGato processes

ChatGato may process the following data on your computer:

- **Codex chat data:** chat identifiers, titles or previews, workspace paths,
  timestamps, reasoning settings, chat status, plan mode, and Codex usage-limit
  information. ChatGato reads this data from Codex's local database,
  configuration, cache, and rollout files, and reads live usage limits through
  the documented local Codex app-server. Rollout data can contain prompts,
  responses, tool calls, and chat settings; ChatGato reads recent rollout data
  locally to derive status and mode, and as a usage compatibility fallback.
- **ChatGato settings:** the selected chat slot, workspace filter, polling
  interval, completion acknowledgement, starter prompt, workspace path,
  auto-submit preference, and related action settings. The Stream Deck software
  stores these settings as part of your local Stream Deck configuration.
- **Optional SSH metadata:** for remote projects already configured in the
  ChatGPT desktop app, ChatGato may process the host identifier, SSH destination,
  username, port, identity-file path, remote project paths, and remote Codex chat
  metadata. ChatGato passes the identity-file path to your system SSH client; it
  does not read or store the private key itself.
- **Operational logs:** Stream Deck keeps local plugin logs containing action
  names, status messages, and errors. Remote connection errors may include a host
  identifier or diagnostic output from SSH. ChatGato does not intentionally log
  chat titles, prompts, or workspace paths.

## How the data is used

This data is used only to provide the plugin's features: showing chat and usage
status, filtering and opening chats, creating chats with user-configured prompts,
and controlling Codex actions.

ChatGato has no analytics, advertising, tracking, user account, or developer-run
server. The plugin does not sell data and does not send data to its developer or
to third parties.

When you use a prompt or workspace action, ChatGato passes the configured values
locally to the installed ChatGPT app at your request. ChatGPT and Codex handle
that data under their own terms and privacy policies. ChatGato does not control
any subsequent processing by those products.

For usage refreshes, ChatGato launches the installed Codex binary and asks its
local app-server for account rate limits. Codex performs its normal authenticated
service request; ChatGato does not read the credentials or call that remote
service directly.

If you use remote projects, chat metadata travels only between your computer and
the SSH host you configured, through your system SSH client. ChatGato does not
route that connection through the developer or another service.

## Storage and retention

Apart from the chat identifier and timestamp saved as a completion
acknowledgement in Stream Deck action settings, ChatGato keeps chat and SSH data
only in memory while the plugin is running and refreshes it as needed. It does
not create a separate persistent copy of Codex chat or SSH data.

Stream Deck retains action settings and rotated local logs according to its own
configuration and lifecycle. Codex retains its original chat data independently
of ChatGato.

## Your choices and deletion

You can stop optional processing at any time:

- Clear prompts and workspace filters, or remove the corresponding action or
  profile, in Stream Deck.
- Remove remote projects or SSH connections in ChatGPT to stop remote discovery.
- Remove ChatGato's local rotated log files using the paths documented in the
  [README](README.md#finding-the-plugin-logs).
- Delete the original chat data through ChatGPT/Codex if you no longer want Codex
  to retain it.

Because the developer does not receive or retain plugin data, there is no remote
ChatGato account or server-side record to delete.
