(() => {
  let socket;
  let context;
  let actionId;
  let settings = {};
  let saveTimer;
  const MAX_AGENT_SLOTS = 20;
  const SETUP_GUIDE_URL =
    "https://github.com/marcoieni/chatgato#required-keyboard-shortcut-setup";

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
  const setupGuideLink = () =>
    `<a class="support-link" href="${SETUP_GUIDE_URL}" data-open-url="${SETUP_GUIDE_URL}" target="_blank" rel="noopener noreferrer">Open shortcut setup guide</a>`;

  function escapeHtml(value) {
    return value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        })[character],
    );
  }

  function selected(name, fallback) {
    const value = settings[name];
    return value === undefined || value === null || value === ""
      ? fallback
      : value;
  }

  function render() {
    note.innerHTML = "";
    switch (actionId) {
      case "com.marco.chatgato.agent-status":
        renderAgent();
        break;
      case "com.marco.chatgato.new-chat":
        renderNewChat();
        break;
      case "com.marco.chatgato.prompt":
        renderPrompt();
        break;
      case "com.marco.chatgato.submit":
        renderDedicatedCommand("Submit", "Submit the current composer input.");
        break;
      case "com.marco.chatgato.fork":
        renderDedicatedCommand(
          "Fork",
          "Copy the current chat into a new local chat.",
        );
        break;
      case "com.marco.chatgato.review-tab":
        renderDedicatedCommand(
          "Review Tab",
          "Open the review tab for the current chat.",
        );
        break;
      case "com.marco.chatgato.toggle-terminal":
        renderDedicatedCommand("Toggle Terminal", "Show or hide the terminal.");
        break;
      case "com.marco.chatgato.open-review":
        renderDedicatedCommand(
          "Review",
          "Start code review mode for the current chat.",
        );
        break;
      case "com.marco.chatgato.settings":
        renderDedicatedCommand("Settings", "Open Codex settings.");
        break;
      case "com.marco.chatgato.plan":
        renderModeShortcut("Plan", "Toggle plan mode", "#ffd600");
        break;
      case "com.marco.chatgato.skills":
        renderDedicatedCommand("Skills", "Open Codex Skills.");
        break;
      case "com.marco.chatgato.scheduled":
        renderDedicatedCommand("Scheduled", "Open scheduled automations.");
        break;
      case "com.marco.chatgato.go-back":
        renderDedicatedCommand("Back", "Go back in Codex navigation history.");
        break;
      case "com.marco.chatgato.go-forward":
        renderDedicatedCommand(
          "Forward",
          "Go forward in Codex navigation history.",
        );
        break;
      case "com.marco.chatgato.toggle-sidebar":
        renderDedicatedCommand(
          "Toggle Sidebar",
          "Show or hide the Codex sidebar.",
        );
        break;
      case "com.marco.chatgato.approve":
        renderDecision(
          "Allow",
          "Allow the request currently waiting in Codex.",
        );
        break;
      case "com.marco.chatgato.decline":
        renderDecision(
          "Decline",
          "Decline the request currently waiting in Codex.",
        );
        break;
      case "com.marco.chatgato.push-to-talk":
        renderPushToTalk();
        break;
      case "com.marco.chatgato.tap-to-talk":
        renderTapToTalk();
        break;
      case "com.marco.chatgato.fast-mode":
        renderDedicatedCommand(
          "Fast Mode",
          "Toggle the persisted Codex response-speed tier.",
        );
        break;
      case "com.marco.chatgato.decrease-reasoning":
        renderDedicatedCommand(
          "Decrease Reasoning",
          "Lower the current chat's reasoning effort by one level.",
        );
        break;
      case "com.marco.chatgato.increase-reasoning":
        renderDedicatedCommand(
          "Increase Reasoning",
          "Raise the current chat's reasoning effort by one level.",
        );
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
    subtitle.textContent = "Live chat status and navigation";
    form.innerHTML =
      field(
        "Agent slot",
        `<select data-setting="slot">${Array.from(
          { length: MAX_AGENT_SLOTS },
          (_, index) => index + 1,
        )
          .map((n) =>
            option(String(n), `Agent ${n}`, String(selected("slot", 1))),
          )
          .join("")}</select>`,
      ) +
      field(
        "Workspace",
        input(
          "cwdFilter",
          selected("cwdFilter", ""),
          "text",
          'placeholder="All workspaces" data-validation="workspace-path" spellcheck="false"',
        ),
        "Optional absolute path. Includes nested workspaces.",
      ) +
      field(
        "Refresh",
        input(
          "pollSeconds",
          selected("pollSeconds", 2),
          "number",
          'min="1" max="30" step="1" required',
        ),
        "Seconds between local status reads.",
      );
    note.innerHTML = `<strong>Remote chat setup:</strong> In ChatGPT desktop, open Settings → Keyboard Shortcuts, search for “Switch chat”, and assign any shortcut you prefer. ChatGato reads the current binding from <code>.codex/keybindings.json</code>, so changes take effect immediately. ${setupGuideLink()} It verifies the binding and moves to the safe Settings surface before entering a title, so it cannot type into the terminal or composer.<br><br><strong>Status colors</strong><div class="legend">
      <span><i style="background:#304ffe"></i>Working</span><span><i style="background:#00ff4c"></i>Done / unread</span>
      <span><i style="background:#ff6d00"></i>Approval</span><span><i style="background:#9e5bff"></i>Needs response</span>
      <span><i style="background:#ff0033"></i>Error</span>
      <span><i style="background:#fff"></i>Idle</span><span><i style="background:#000;border:1px solid #555"></i>Empty</span>
    </div>`;
  }

  function renderNewChat() {
    subtitle.textContent = "Open a new local Codex chat";
    form.innerHTML =
      field(
        "Workspace",
        input(
          "path",
          selected("path", ""),
          "text",
          'placeholder="/absolute/path/to/project" data-validation="workspace-path" spellcheck="false"',
        ),
      ) +
      field(
        "Prompt",
        `<textarea data-setting="prompt" placeholder="Optional starter prompt">${escapeHtml(String(selected("prompt", "")))}</textarea>`,
        "",
        "top",
      ) +
      field(
        "Auto-submit",
        checkbox("autoSubmit", Boolean(selected("autoSubmit", false))),
        "Sends the prompt after opening Codex.",
        "check",
      ) +
      field(
        "Submit delay",
        input(
          "submitDelayMs",
          selected("submitDelayMs", 900),
          "number",
          'min="300" max="5000" step="100" required',
        ),
        "Milliseconds; only used with auto-submit.",
      );
    note.textContent =
      "Without auto-submit, Codex opens with the prompt in the composer so you can review it first.";
  }

  function renderPrompt() {
    subtitle.textContent = "Open a chat with your prompt";
    form.innerHTML =
      field(
        "Prompt",
        `<textarea data-setting="prompt" placeholder="What should Codex do? You can include $skill-name.">${escapeHtml(String(selected("prompt", "")))}</textarea>`,
        "",
        "top",
      ) +
      field(
        "Workspace",
        input(
          "path",
          selected("path", ""),
          "text",
          'placeholder="/absolute/path/to/project" data-validation="workspace-path" spellcheck="false"',
        ),
      ) +
      field(
        "Auto-submit",
        checkbox("autoSubmit", Boolean(selected("autoSubmit", false))),
        "Runs the prompt immediately.",
        "check",
      ) +
      field(
        "Submit delay",
        input(
          "submitDelayMs",
          selected("submitDelayMs", 900),
          "number",
          'min="300" max="5000" step="100" required',
        ),
      );
    note.innerHTML =
      "Codex receives this prompt as written. Include <code>$skill-name</code> to invoke a skill explicitly; Codex may also choose a matching skill automatically.";
  }

  function renderDedicatedCommand(label, description) {
    subtitle.textContent = label;
    form.innerHTML = `<p>${description}</p>`;
    note.textContent = "This action has no configuration.";
  }

  function renderDecision(label, description) {
    subtitle.textContent = `${label} a Codex request`;
    form.innerHTML = `<p>${description}</p>`;
    note.textContent =
      "This action uses Codex's context-sensitive keyboard shortcut. On macOS, Stream Deck may need Accessibility permission.";
  }

  function renderPushToTalk() {
    subtitle.textContent = "Dictate into Codex";
    form.innerHTML =
      "<p>Hold the key while speaking, then release it to stop dictation.</p>";
    note.textContent =
      "The key turns yellow while active and holds Codex's dictation shortcut for as long as you press it. On macOS, Stream Deck may need Accessibility permission.";
  }

  function renderTapToTalk() {
    subtitle.textContent = "Toggle Codex dictation";
    form.innerHTML =
      "<p>Press once to start dictation, then press again to stop it. You can release the key while speaking.</p>";
    note.textContent =
      "The key turns yellow and changes to TAP TO STOP while active. On macOS, Stream Deck may need Accessibility permission.";
  }

  function renderModeShortcut(label, commandName, onColor) {
    subtitle.textContent = `Toggle Codex ${label.toLowerCase()}`;
    form.innerHTML = `<p><strong>Required setup:</strong> In ChatGPT desktop, open Settings → Keyboard Shortcuts, search for “${commandName}”, and assign any shortcut you prefer. ChatGato reads it from <code>.codex/keybindings.json</code>. ${setupGuideLink()}</p>`;
    note.innerHTML = `<strong>This action will not work until the shortcut is configured.</strong> A warning means ChatGato could not read or send the shortcut to ChatGPT.<div class="legend">
      <span><i style="background:#303840"></i>Off</span><span><i style="background:${onColor}"></i>On</span>
    </div>`;
  }

  function renderReasoning() {
    subtitle.textContent = "Adjust reasoning with a dial";
    form.innerHTML = field(
      "Max steps",
      input(
        "maxStepsPerGesture",
        selected("maxStepsPerGesture", 3),
        "number",
        'min="1" max="5" step="1" required',
      ),
      "Caps commands from one fast dial gesture.",
    );
    note.textContent =
      "Turn right to increase reasoning and left to decrease it. Standard decks use the separate Increase Reasoning and Decrease Reasoning actions.";
  }

  function renderUsage() {
    subtitle.textContent = "Live Codex allowance remaining";
    form.innerHTML = field(
      "Refresh",
      input(
        "pollSeconds",
        selected("pollSeconds", 15),
        "number",
        'min="5" max="300" step="1" required',
      ),
      "Seconds between local usage reads.",
    );
    note.textContent =
      "The key shows the live percentage left in each rate-limit window (for example, 5H and 1W). Press it to refresh immediately. Local rollout data is used only when Codex's app-server is unavailable.";
  }

  function bind() {
    for (const element of form.querySelectorAll("[data-setting]")) {
      if (element.type === "number" || element.dataset.validation) {
        ensureValidationMessage(element);
      }
      element.addEventListener("input", handleSettingChange);
      element.addEventListener("change", handleSettingChange);
    }
    for (const link of document.querySelectorAll("[data-open-url]")) {
      link.addEventListener("click", openSupportLink);
    }
    validateForm();
  }

  function openSupportLink(event) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    event.preventDefault();
    socket.send(
      JSON.stringify({
        event: "openUrl",
        payload: { url: event.currentTarget.dataset.openUrl },
      }),
    );
  }

  function handleSettingChange() {
    validateForm();
    scheduleSave();
  }

  function ensureValidationMessage(element) {
    const label = element.closest("label");
    if (!label) return;
    const message = document.createElement("small");
    message.id = `${element.dataset.setting}-error`;
    message.className = "validation-error";
    message.setAttribute("aria-live", "polite");
    label.append(message);
    element.setAttribute("aria-describedby", message.id);
  }

  function validateForm() {
    let valid = true;
    for (const element of form.querySelectorAll("[data-setting]")) {
      const message = validationMessage(element);
      element.setCustomValidity(message);
      element.setAttribute("aria-invalid", String(Boolean(message)));
      element
        .closest("label")
        ?.querySelector(".validation-error")
        ?.replaceChildren(message);
      if (message) valid = false;
    }
    return valid;
  }

  function validationMessage(element) {
    const label = element.closest("label")?.firstElementChild?.textContent;
    const name = label || "This value";
    const value = element.value.trim();

    if (element.type === "number") {
      if (!value || !Number.isFinite(Number(value))) {
        return `${name} must be a number.`;
      }

      const number = Number(value);
      const min = element.min === "" ? null : Number(element.min);
      const max = element.max === "" ? null : Number(element.max);
      if (min !== null && number < min) {
        return `${name} must be at least ${min}.`;
      }
      if (max !== null && number > max) {
        return `${name} must be at most ${max}.`;
      }
      if (element.validity.stepMismatch) {
        return `${name} must use increments of ${element.step}.`;
      }
    }

    if (
      element.dataset.validation === "workspace-path" &&
      value &&
      !isAbsoluteWorkspacePath(value)
    ) {
      return "Workspace must be an absolute path, such as /Users/name/project or C:\\Users\\name\\project.";
    }

    return "";
  }

  function isAbsoluteWorkspacePath(value) {
    return (
      value.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(value) ||
      /^\\\\[^\\]+\\[^\\]+/.test(value) ||
      /^\/\/[^/]+\/[^/]+/.test(value)
    );
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 120);
  }

  function save() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!validateForm()) return;
    const next = { ...settings };
    for (const element of form.querySelectorAll("[data-setting]")) {
      const key = element.dataset.setting;
      if (element.type === "checkbox") next[key] = element.checked;
      else if (element.type === "number") next[key] = Number(element.value);
      else next[key] = element.value;
    }
    settings = next;
    socket.send(
      JSON.stringify({ event: "setSettings", context, payload: settings }),
    );
  }

  window.connectElgatoStreamDeckSocket = (
    port,
    propertyInspectorUUID,
    registerEvent,
    info,
    actionInfo,
  ) => {
    context = propertyInspectorUUID;
    const parsed = JSON.parse(actionInfo);
    actionId = parsed.action;
    settings = parsed.payload?.settings || {};
    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({ event: registerEvent, uuid: propertyInspectorUUID }),
      );
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
