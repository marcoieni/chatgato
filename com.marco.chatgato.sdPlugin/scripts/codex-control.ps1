param(
  [Parameter(Mandatory = $true)][string]$Mode,
  [Parameter(Mandatory = $true)][string]$Payload
)

$shell = New-Object -ComObject WScript.Shell

function Invoke-SlashModeToggle([string]$ModeCommand) {
  Add-Type -AssemblyName System.Windows.Forms
  $clipboardMarker = "__CHATGATO_EMPTY_DRAFT_$([Guid]::NewGuid())__"
  $savedClipboard = [System.Windows.Forms.Clipboard]::GetDataObject()

  try {
    [System.Windows.Forms.Clipboard]::SetText($clipboardMarker)
    $shell.SendKeys("^a")
    $shell.SendKeys("^x")
    Start-Sleep -Milliseconds 100
    $draftText = [System.Windows.Forms.Clipboard]::GetText()

    $shell.SendKeys($ModeCommand)
    Start-Sleep -Milliseconds 180
    $shell.SendKeys("{ENTER}")
    Start-Sleep -Milliseconds 220

    if ($draftText -ne $clipboardMarker) {
      [System.Windows.Forms.Clipboard]::SetText($draftText)
      $shell.SendKeys("^v")
      Start-Sleep -Milliseconds 100
    }
  }
  finally {
    if ($null -eq $savedClipboard) {
      [System.Windows.Forms.Clipboard]::Clear()
    }
    else {
      [System.Windows.Forms.Clipboard]::SetDataObject($savedClipboard, $true)
    }
  }
}

function Exit-PlanMode {
  $shell.SendKeys("^{HOME}")
  Start-Sleep -Milliseconds 50
  $shell.SendKeys("{BACKSPACE}")
  Start-Sleep -Milliseconds 350
}

if ($Mode -eq "shortcut" -and $Payload -in @("dictationDown", "dictationUp")) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ChatGatoKeyboard {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
}
"@
  if ($Payload -eq "dictationUp") {
    $keyUp = 0x0002
    [ChatGatoKeyboard]::keybd_event(0x44, 0, $keyUp, [UIntPtr]::Zero)
    [ChatGatoKeyboard]::keybd_event(0x10, 0, $keyUp, [UIntPtr]::Zero)
    [ChatGatoKeyboard]::keybd_event(0x11, 0, $keyUp, [UIntPtr]::Zero)
    exit 0
  }
}

if ($Mode -eq "url") {
  Start-Process $Payload
  exit 0
}

if (-not $shell.AppActivate("ChatGPT")) {
  throw "ChatGPT is not running"
}
Start-Sleep -Milliseconds 180

if ($Mode -eq "shortcut" -and $Payload -eq "dictationDown") {
  [ChatGatoKeyboard]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
  [ChatGatoKeyboard]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)
  [ChatGatoKeyboard]::keybd_event(0x44, 0, 0, [UIntPtr]::Zero)
  exit 0
}

if ($Mode -eq "mode") {
  if ($Payload -in @("fastOn", "fastOff")) {
    Invoke-SlashModeToggle "/fast"
    exit 0
  }
  if ($Payload -eq "planOn") {
    Invoke-SlashModeToggle "/plan"
    exit 0
  }
  if ($Payload -eq "planOff") {
    Exit-PlanMode
    exit 0
  }
  throw "Unknown Codex mode: $Payload"
}

if ($Mode -eq "slash") {
  if ($Payload -notmatch '^/[a-z][a-z-]*$') { throw "Invalid Codex slash command" }
  $shell.SendKeys($Payload)
  Start-Sleep -Milliseconds 180
  $shell.SendKeys("{ENTER}")
  exit 0
}

if ($Mode -eq "reasoning") {
  $optionIndex = 0
  if (-not [int]::TryParse($Payload, [ref]$optionIndex) -or $optionIndex -lt 0 -or $optionIndex -gt 20) {
    throw "Invalid reasoning option index"
  }
  $shell.SendKeys("/reasoning")
  Start-Sleep -Milliseconds 180
  $shell.SendKeys("{ENTER}")
  Start-Sleep -Milliseconds 220
  $shell.SendKeys("{HOME}")
  for ($index = 0; $index -lt $optionIndex; $index += 1) {
    $shell.SendKeys("{DOWN}")
  }
  $shell.SendKeys("{ENTER}")
  exit 0
}

if ($Mode -ne "shortcut") { throw "Unknown Codex control mode: $Mode" }

$shortcuts = @{
  approve = "{ENTER}"
  decline = "{ESC}"
  submit = "{ENTER}"
  terminal = '^`'
  review = "^+g"
  navigateBack = "^{[}"
  navigateForward = "^{]}"
  toggleSidebar = "^b"
}

if (-not $shortcuts.ContainsKey($Payload)) { throw "Unknown Codex shortcut: $Payload" }
$shell.SendKeys($shortcuts[$Payload])
