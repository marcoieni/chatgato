on run argv
	if (count of argv) < 2 then error "Missing Codex control arguments"
	set controlMode to item 1 of argv
	set payload to item 2 of argv

	if controlMode is "shortcut" and payload is "dictationUp" then
		tell application "System Events"
			key up "d"
			key up {shift, control}
		end tell
		return
	end if

	tell application "ChatGPT" to activate
	delay 0.18

	tell application "System Events"
		if controlMode is "slash" then
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
			else if payload is "toggleFastMode" then
				keystroke "f" using {command down, option down, shift down}
			else if payload is "togglePlanMode" then
				keystroke "p" using {command down, option down, shift down}
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
end run
