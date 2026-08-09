on run argv
	if (count of argv) < 2 then error "Missing Codex control arguments"
	set controlMode to item 1 of argv
	set payload to item 2 of argv
	set resultIndex to 0
	set maxResultIndex to 0
	set shortcutBinding to ""
	if controlMode is "thread" then
		if (count of argv) < 5 then error "Missing Codex task search arguments"
		set resultIndex to item 3 of argv as integer
		set maxResultIndex to item 4 of argv as integer
		set shortcutBinding to item 5 of argv
	end if

	if controlMode is "shortcut" and payload is "dictationUp" then
		tell application "System Events"
			key up "d"
			key up {shift, control}
		end tell
		return
	end if

	tell application "ChatGPT" to activate
	delay 0.18

	repeat with attempt from 1 to 3
		try
			my sendControl(controlMode, payload, resultIndex, maxResultIndex, shortcutBinding)
			return
		on error errorMessage number errorNumber
			if errorNumber is not -600 then error errorMessage number errorNumber
			if attempt is 3 then error errorMessage number errorNumber
			-- ChatGPT can still be finishing activation when System Events sends
			-- the first keystroke. Reactivate it and retry this transient failure.
			tell application "ChatGPT" to activate
			delay 0.35
		end try
	end repeat
end run

on sendControl(controlMode, payload, resultIndex, maxResultIndex, shortcutBinding)
	tell application "System Events"
		if controlMode is "thread" then
			if maxResultIndex < 0 or resultIndex < 0 or resultIndex > maxResultIndex then error "Invalid Codex task search index"
			my sendKeybinding(shortcutBinding)
			delay 0.75
			keystroke payload
			delay 1.5
			repeat resultIndex times
				key code 125
				delay 0.05
			end repeat
			key code 36
		else if controlMode is "keybinding" then
			my sendKeybinding(payload)
		else if controlMode is "slash" then
			keystroke payload
			delay 0.18
			key code 36
		else if controlMode is "reasoning" then
			set optionIndex to payload as integer
			if optionIndex < 0 or optionIndex > 20 then error "Invalid reasoning option index"
			keystroke "/reasoning"
			delay 0.18
			key code 36
			delay 0.22
			key code 115
			repeat optionIndex times
				key code 125
			end repeat
			key code 36
		else if controlMode is "shortcut" then
			if payload is "dictationDown" then
				key down {control, shift}
				key down "d"
			else if payload is "approve" then
				key code 36
			else if payload is "decline" then
				key code 53
			else if payload is "submit" then
				key code 36
			else if payload is "terminal" then
				key code 50 using {control down}
			else if payload is "review" then
				keystroke "g" using {control down, shift down}
			else if payload is "navigateBack" then
				key code 33 using {command down}
			else if payload is "navigateForward" then
				key code 30 using {command down}
			else if payload is "toggleSidebar" then
				keystroke "b" using {command down}
			else
				error "Unknown Codex shortcut: " & payload
			end if
		else
			error "Unknown Codex control mode: " & controlMode
		end if
	end tell
end sendControl

on sendKeybinding(shortcutText)
	set previousDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to "+"
	set shortcutParts to text items of shortcutText
	set AppleScript's text item delimiters to previousDelimiters
	set modifierKeys to {}
	set keyName to ""
	repeat with shortcutPart in shortcutParts
		set partText to shortcutPart as text
		if partText is "command" then
			set end of modifierKeys to command down
		else if partText is "control" then
			set end of modifierKeys to control down
		else if partText is "alt" then
			set end of modifierKeys to option down
		else if partText is "shift" then
			set end of modifierKeys to shift down
		else if keyName is "" then
			set keyName to partText
		else
			error "Invalid Codex keybinding"
		end if
	end repeat
	if keyName is "" then error "Invalid Codex keybinding"

	set keyCodeValue to my keyCodeForName(keyName)
	tell application "System Events"
		if keyCodeValue is greater than or equal to 0 then
			key code keyCodeValue using modifierKeys
		else if keyName is "space" then
			keystroke " " using modifierKeys
		else if keyName is "plus" then
			keystroke "+" using modifierKeys
		else
			keystroke keyName using modifierKeys
		end if
	end tell
end sendKeybinding

on keyCodeForName(keyName)
	if keyName is "enter" then return 36
	if keyName is "tab" then return 48
	if keyName is "backspace" then return 51
	if keyName is "escape" then return 53
	if keyName is "insert" then return 114
	if keyName is "home" then return 115
	if keyName is "pageup" then return 116
	if keyName is "delete" then return 117
	if keyName is "end" then return 119
	if keyName is "pagedown" then return 121
	if keyName is "left" then return 123
	if keyName is "right" then return 124
	if keyName is "down" then return 125
	if keyName is "up" then return 126
	if keyName is "f1" then return 122
	if keyName is "f2" then return 120
	if keyName is "f3" then return 99
	if keyName is "f4" then return 118
	if keyName is "f5" then return 96
	if keyName is "f6" then return 97
	if keyName is "f7" then return 98
	if keyName is "f8" then return 100
	if keyName is "f9" then return 101
	if keyName is "f10" then return 109
	if keyName is "f11" then return 103
	if keyName is "f12" then return 111
	if keyName is "f13" then return 105
	if keyName is "f14" then return 107
	if keyName is "f15" then return 113
	if keyName is "f16" then return 106
	if keyName is "f17" then return 64
	if keyName is "f18" then return 79
	if keyName is "f19" then return 80
	if keyName is "f20" then return 90
	return -1
end keyCodeForName
