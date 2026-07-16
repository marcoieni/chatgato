(() => {
  let socket;
  let context;
  let actionId;
  let settings = {};
  let saveTimer;
  const MAX_AGENT_SLOTS = 20;
  const LEGACY_WORKFLOW_PROMPTS = {
    reviewPr: "Review the current pull request. Inspect the diff, identify correctness issues and regressions, and report findings ordered by severity.",
    debug: "Debug the current error. Reproduce it, identify the root cause, implement a focused fix, and verify it with relevant tests.",
    refactor: "Refactor the selected area for clarity and maintainability without changing behavior. Keep the change focused and verify it with tests.",
    tests: "Add or improve tests for the current change. Cover meaningful edge cases, run the relevant test suite, and summarize the result.",
    security: "Review the current changes for security vulnerabilities. Trace affected trust boundaries and report actionable findings ordered by severity.",
    docs: "Update the relevant documentation for the current change. Keep examples accurate, concise, and verified against the implementation.",
  };

  const form = document.getElementById("settings");
  const subtitle = document.getElementById("subtitle");
  const note = document.getElementById("note");

  const field = (label, control, hint = "", extra = "") =>
    `<label class="${extra}"><span>${label}</span>${control}${hint ? `<small class="hint">${hint}</small>` : ""}</label>`;
  const input = (name, value = "", type = "text", attrs = "") =>
    `<input data-setting="${name}" type="${type}" value="${escapeHtml(String(value))}" ${attrs}>`;
  const checkbox = (name, checked = false) =>
    `<input data-setting="${name}" type="checkbox" ${checked ? "checked" : ""}>`;
  const option = (value, label, selected) =>
    `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`;

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    })[character]);
  }

  function selected(name, fallback) {
    const value = settings[name];
    return value === undefined || value === null || value === "" ? fallback : value;
  }

  function render() {
    note.innerHTML = "";
    switch (actionId) {
      case "com.marco.chatgato.agent-status":
        renderAgent();
        break;
      case "com.marco.chatgato.new-task":
        renderNewTask();
        break;
      case "com.marco.chatgato.workflow":
        renderRunPrompt();
        break;
      case "com.marco.chatgato.command":
        renderCommand();
        break;
      case "com.marco.chatgato.submit":
        renderDedicatedCommand("Submit", "Submit the current composer input.");
        break;
      case "com.marco.chatgato.fork":
        renderDedicatedCommand("Fork", "Copy the current task into a new local task.");
        break;
      case "com.marco.chatgato.review-tab":
        renderDedicatedCommand("Review Tab", "Open the review tab for the current task.");
        break;
      case "com.marco.chatgato.toggle-terminal":
        renderDedicatedCommand("Toggle Terminal", "Show or hide the terminal.");
        break;
      case "com.marco.chatgato.open-review":
        renderDedicatedCommand("Review", "Start code review mode for the current task.");
        break;
      case "com.marco.chatgato.settings":
        renderDedicatedCommand("Settings", "Open Codex settings.");
        break;
      case "com.marco.chatgato.plan":
        renderDedicatedCommand("Plan", "Toggle plan mode for the current task.");
        break;
      case "com.marco.chatgato.skills":
        renderDedicatedCommand("Skills", "Open Codex Skills.");
        break;
      case "com.marco.chatgato.scheduled":
        renderDedicatedCommand("Scheduled", "Open scheduled automations.");
        break;
      case "com.marco.chatgato.go-back":
        renderDedicatedCommand("Go Back", "Go back in Codex navigation history.");
        break;
      case "com.marco.chatgato.go-forward":
        renderDedicatedCommand("Go Forward", "Go forward in Codex navigation history.");
        break;
      case "com.marco.chatgato.toggle-sidebar":
        renderDedicatedCommand("Toggle Sidebar", "Show or hide the Codex sidebar.");
        break;
      case "com.marco.chatgato.approve":
        renderDecision("Allow", "Allow the request currently waiting in Codex.");
        break;
      case "com.marco.chatgato.decline":
        renderDecision("Decline", "Decline the request currently waiting in Codex.");
        break;
      case "com.marco.chatgato.push-to-talk":
        renderPushToTalk();
        break;
      case "com.marco.chatgato.tap-to-talk":
        renderTapToTalk();
        break;
      case "com.marco.chatgato.fast-mode":
        renderFastMode();
        break;
      case "com.marco.chatgato.reasoning":
        renderReasoning();
        break;
      case "com.marco.chatgato.usage":
        renderUsage();
        break;
      default:
        form.innerHTML = "<p>Unknown ChatGato action.</p>";
    }
    bind();
  }

  function renderAgent() {
    subtitle.textContent = "Live task status and navigation";
    form.innerHTML =
      field("Agent slot", `<select data-setting="slot">${Array.from({ length: MAX_AGENT_SLOTS }, (_, index) => index + 1).map((n) => option(String(n), `Agent ${n}`, String(selected("slot", 1)))).join("")}</select>`) +
      field("Workspace", input("cwdFilter", selected("cwdFilter", ""), "text", 'placeholder="All workspaces"'), "Optional absolute path. Includes nested workspaces.") +
      field("Refresh", input("pollSeconds", selected("pollSeconds", 2), "number", 'min="1" max="30" step="1"'), "Seconds between local status reads.");
    note.innerHTML = `<strong>Status colors</strong><div class="legend">
      <span><i style="background:#304ffe"></i>Working</span><span><i style="background:#00ff4c"></i>Done / unread</span>
      <span><i style="background:#ff6d00"></i>Approval</span><span><i style="background:#9e5bff"></i>Needs response</span>
      <span><i style="background:#ff0033"></i>Error</span>
      <span><i style="background:#fff"></i>Idle</span><span><i style="background:#000;border:1px solid #555"></i>Empty</span>
    </div>`;
  }

  function renderNewTask() {
    subtitle.textContent = "Open a new local Codex task";
    form.innerHTML =
      field("Workspace", input("path", selected("path", ""), "text", 'placeholder="/absolute/path/to/project"')) +
      field("Prompt", `<textarea data-setting="prompt" placeholder="Optional starter prompt">${escapeHtml(String(selected("prompt", "")))}</textarea>`, "", "top") +
      field("Auto-submit", checkbox("autoSubmit", Boolean(selected("autoSubmit", false))), "Sends the prompt after opening Codex.", "check") +
      field("Submit delay", input("submitDelayMs", selected("submitDelayMs", 900), "number", 'min="300" max="5000" step="100"'), "Milliseconds; only used with auto-submit.");
    note.textContent = "Without auto-submit, Codex opens with the prompt in the composer so you can review it first.";
  }

  function legacyRunPrompt() {
    if (settings.workflow === undefined && settings.customPrompt === undefined && settings.skillName === undefined) {
      return "";
    }
    const workflow = String(selected("workflow", "reviewPr"));
    const base = workflow === "custom"
      ? String(selected("customPrompt", "")).trim()
      : LEGACY_WORKFLOW_PROMPTS[workflow] || LEGACY_WORKFLOW_PROMPTS.reviewPr;
    const skill = String(selected("skillName", "")).trim().replace(/^\$/, "");
    return skill ? `$${skill} ${base}`.trim() : base;
  }

  function renderRunPrompt() {
    subtitle.textContent = "Open a task with your prompt";
    const prompt = settings.prompt === undefined || settings.prompt === null
      ? legacyRunPrompt()
      : String(settings.prompt);
    form.innerHTML =
      field("Prompt", `<textarea data-setting="prompt" placeholder="What should Codex do? You can include $skill-name.">${escapeHtml(prompt)}</textarea>`, "", "top") +
      field("Workspace", input("path", selected("path", ""), "text", 'placeholder="/absolute/path/to/project"')) +
      field("Auto-submit", checkbox("autoSubmit", Boolean(selected("autoSubmit", false))), "Runs the prompt immediately.", "check") +
      field("Submit delay", input("submitDelayMs", selected("submitDelayMs", 900), "number", 'min="300" max="5000" step="100"'));
    note.innerHTML = "Codex receives this prompt as written. Include <code>$skill-name</code> to invoke a skill explicitly; Codex may also choose a matching skill automatically.";
  }

  const commandGroups = [
    ["Workspace", [["environmentAction","Run environment action"],["openFolder","Open folder"],["openBrowser","Open browser"],["addFiles","Add files"],["addPhotos","Add photos"]]],
    ["Git", [["commit","Commit"],["pullRequest","Create pull request"]]],
    ["Navigation", [["searchTasks","Search tasks"],["previousTask","Previous task"],["nextTask","Next task"],["togglePin","Pin task"]]],
    ["Utilities", [["copyMarkdown","Copy conversation Markdown"],["archiveThread","Archive task"],["feedback","Send feedback"],["sideChat","Open side chat"],["docs","OpenAI developer docs"]]],
  ];

  const dedicatedCommandLabels = {
    approve: "Allow",
    decline: "Decline",
    submit: "Submit",
    forkThread: "Fork",
    review: "Review Tab",
    terminal: "Toggle Terminal",
    openReview: "Review",
    settings: "Settings",
    togglePlan: "Plan",
    skills: "Skills",
    scheduled: "Scheduled",
    navigateBack: "Go Back",
    navigateForward: "Go Forward",
    toggleSidebar: "Toggle Sidebar",
    newTask: "New Task",
    reasoningUp: "Increase Reasoning",
    reasoningDown: "Decrease Reasoning",
  };

  function renderCommand() {
    subtitle.textContent = "Map a Codex command";
    const command = String(selected("command", "environmentAction"));
    const dedicatedLabel = dedicatedCommandLabels[command];
    const legacyDedicated = dedicatedLabel
      ? `<optgroup label="Existing configuration"><option value="${command}" selected disabled>${dedicatedLabel} (legacy)</option></optgroup>`
      : "";
    const options = legacyDedicated + commandGroups.map(([group, values]) => `<optgroup label="${group}">${values.map(([value, label]) => option(value, label, command)).join("")}</optgroup>`).join("");
    form.innerHTML =
      field("Command", `<select data-setting="command">${options}</select>`) +
      field("Menu query", input("paletteQuery", selected("paletteQuery", ""), "text", 'placeholder="Optional localized command name"'), "Overrides Command Menu text for palette-based commands.");
    note.innerHTML = legacyDedicated
      ? `This existing key will keep working. Use the dedicated <strong>${dedicatedLabel}</strong> action for new keys.`
      : "Commands without public deep links use the Codex <strong>Command Menu</strong>. macOS may ask you to grant Stream Deck accessibility control.";
  }

  function renderDedicatedCommand(label, description) {
    subtitle.textContent = label;
    form.innerHTML = `<p>${description}</p>`;
    note.textContent = "This action has no configuration.";
  }

  function renderDecision(label, description) {
    subtitle.textContent = `${label} a Codex request`;
    form.innerHTML = `<p>${description}</p>`;
    note.textContent = "This action uses Codex's context-sensitive keyboard shortcut. On macOS, Stream Deck may need Accessibility permission.";
  }

  function renderPushToTalk() {
    subtitle.textContent = "Dictate into Codex";
    form.innerHTML = "<p>Hold the key while speaking, then release it to stop dictation.</p>";
    note.textContent = "The key turns yellow while active and holds Codex's dictation shortcut for as long as you press it. On macOS, Stream Deck may need Accessibility permission.";
  }

  function renderTapToTalk() {
    subtitle.textContent = "Toggle Codex dictation";
    form.innerHTML = "<p>Press once to start dictation, then press again to stop it. You can release the key while speaking.</p>";
    note.textContent = "The key turns yellow and changes to TAP TO STOP while active. On macOS, Stream Deck may need Accessibility permission.";
  }

  function renderFastMode() {
    subtitle.textContent = "Toggle Codex fast mode";
    form.innerHTML = "<p>Press the key to switch fast mode on or off.</p>";
    note.innerHTML = `<strong>Key colors</strong><div class="legend">
      <span><i style="background:#303840"></i>Off</span><span><i style="background:#00ff4c"></i>On</span>
    </div>`;
  }

  function renderReasoning() {
    subtitle.textContent = "Set the brainpower in the moment";
    const direction = String(selected("keyDirection", "increase"));
    form.innerHTML =
      field("Key press", `<select data-setting="keyDirection">${option("increase","Increase",direction)}${option("decrease","Decrease",direction)}</select>`) +
      field("Max steps", input("maxStepsPerGesture", selected("maxStepsPerGesture", 3), "number", 'min="1" max="5" step="1"'), "Caps commands from one fast dial gesture.");
    note.textContent = "On Stream Deck+, turn right to increase reasoning and left to decrease it. On a standard key, the selected Key press direction is used.";
  }

  function renderUsage() {
    subtitle.textContent = "Live Codex allowance remaining";
    form.innerHTML =
      field("Refresh", input("pollSeconds", selected("pollSeconds", 15), "number", 'min="5" max="300" step="1"'), "Seconds between local usage reads.");
    note.textContent = "The key shows the percentage left in each rate-limit window (for example, 5H and 1W). Press it to refresh immediately. Data updates locally whenever Codex reports usage for a task.";
  }

  function bind() {
    for (const element of form.querySelectorAll("[data-setting]")) {
      element.addEventListener("input", scheduleSave);
      element.addEventListener("change", scheduleSave);
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 120);
  }

  function save() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const next = { ...settings };
    for (const element of form.querySelectorAll("[data-setting]")) {
      const key = element.dataset.setting;
      if (element.type === "checkbox") next[key] = element.checked;
      else if (element.type === "number") next[key] = Number(element.value);
      else next[key] = element.value;
    }
    settings = next;
    socket.send(JSON.stringify({ event: "setSettings", context, payload: settings }));
  }

  window.connectElgatoStreamDeckSocket = (port, propertyInspectorUUID, registerEvent, info, actionInfo) => {
    context = propertyInspectorUUID;
    const parsed = JSON.parse(actionInfo);
    actionId = parsed.action;
    settings = parsed.payload?.settings || {};
    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ event: registerEvent, uuid: propertyInspectorUUID }));
      render();
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.event === "didReceiveSettings") {
        settings = message.payload?.settings || settings;
      }
    });
  };
})();
