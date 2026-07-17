use framework "AppKit"
use scripting additions

on copyPasteboardItems(pasteboard)
	set copiedItems to current application's NSMutableArray's array()
	repeat with sourceItem in (pasteboard's pasteboardItems())
		set copiedItem to current application's NSPasteboardItem's alloc()'s init()
		repeat with itemType in (sourceItem's types())
			set itemData to sourceItem's dataForType:itemType
			if itemData is not missing value then copiedItem's setData:itemData forType:itemType
		end repeat
		copiedItems's addObject:copiedItem
	end repeat
	return copiedItems
end copyPasteboardItems

on restorePasteboardItems(pasteboard, savedItems)
	try
		pasteboard's clearContents()
		pasteboard's writeObjects:savedItems
	end try
end restorePasteboardItems

on codexWindow()
	tell application "System Events"
		tell process "ChatGPT"
			set selectedWindow to missing value
			set selectedArea to 0
			repeat with candidateWindow in windows
				try
					set candidateSize to size of candidateWindow
					set candidateWidth to item 1 of candidateSize
					set candidateHeight to item 2 of candidateSize
					set candidateArea to candidateWidth * candidateHeight
					if candidateWidth ≥ 600 and candidateHeight ≥ 400 and candidateArea > selectedArea then
						set selectedWindow to candidateWindow
						set selectedArea to candidateArea
					end if
				end try
			end repeat
			if selectedWindow is missing value then error "Codex window is not available"
			return selectedWindow
		end tell
	end tell
end codexWindow

on isComposerElement(candidate, appWindow)
	if candidate is missing value then return false
	tell application "System Events"
		tell process "ChatGPT"
			try
				if role of candidate is not "AXTextArea" then return false
				set candidatePosition to position of candidate
				set candidateSize to size of candidate
				set windowPosition to position of appWindow
				set windowSize to size of appWindow
				set candidateX to item 1 of candidatePosition
				set candidateY to item 2 of candidatePosition
				set windowLeft to item 1 of windowPosition
				set windowTop to item 2 of windowPosition
				set windowWidth to item 1 of windowSize
				set windowHeight to item 2 of windowSize
				return (item 1 of candidateSize) ≥ 250 and candidateX ≥ windowLeft and candidateX < windowLeft + windowWidth and candidateY ≥ windowTop + (windowHeight * 0.55) and candidateY < windowTop + windowHeight
			on error
				return false
			end try
		end tell
	end tell
end isComposerElement

on composerInBottomRegion(containerElement, appWindow, remainingDepth)
	if remainingDepth ≤ 0 then return missing value
	tell application "System Events"
		tell process "ChatGPT"
			try
				set windowPosition to position of appWindow
				set windowSize to size of appWindow
				set windowBottom to (item 2 of windowPosition) + (item 2 of windowSize)
				set bottomThreshold to (item 2 of windowPosition) + ((item 2 of windowSize) * 0.55)
				set childElements to UI elements of containerElement
			on error
				return missing value
			end try
		end tell
	end tell
	repeat with childElement in childElements
		if my isComposerElement(childElement, appWindow) then return childElement
		set shouldDescend to false
		tell application "System Events"
			tell process "ChatGPT"
				try
					set childPosition to position of childElement
					set childSize to size of childElement
					set childTop to item 2 of childPosition
					set childBottom to childTop + (item 2 of childSize)
					set shouldDescend to (item 1 of childSize) ≥ 200 and (item 2 of childSize) > 0 and childTop < windowBottom and childBottom > bottomThreshold
				end try
			end tell
		end tell
		if shouldDescend then
			set composerElement to my composerInBottomRegion(childElement, appWindow, remainingDepth - 1)
			if composerElement is not missing value then return composerElement
		end if
	end repeat
	return missing value
end composerInBottomRegion

on composerNearFocusedElement(focusedElement, appWindow)
	if focusedElement is missing value then return missing value
	set candidateParent to focusedElement
	tell application "System Events"
		tell process "ChatGPT"
			repeat 8 times
				try
					set candidatePosition to position of candidateParent
					set candidateSize to size of candidateParent
					set windowPosition to position of appWindow
					set windowSize to size of appWindow
					if (item 1 of candidateSize) ≥ 500 and (item 2 of candidateSize) ≤ 320 and (item 2 of candidatePosition) ≥ (item 2 of windowPosition) + ((item 2 of windowSize) * 0.55) then
						repeat with descendant in entire contents of candidateParent
							if my isComposerElement(descendant, appWindow) then return descendant
						end repeat
					end if
					set candidateParent to value of attribute "AXParent" of candidateParent
					if candidateParent is missing value then exit repeat
				on error
					exit repeat
				end try
			end repeat
		end tell
	end tell
	return missing value
end composerNearFocusedElement

on focusedComposer()
	set appWindow to my codexWindow()
	tell application "System Events"
		tell process "ChatGPT"
			set focusedElement to value of attribute "AXFocusedUIElement"
		end tell
	end tell
	if my isComposerElement(focusedElement, appWindow) then return focusedElement
	set composerElement to my composerNearFocusedElement(focusedElement, appWindow)
	if composerElement is not missing value then
		my focusElement(composerElement)
		return composerElement
	end if

	-- Computer Use and other utilities can add small overlay windows to the
	-- ChatGPT process. Raise the largest Codex window and use Escape's native
	-- focus-composer behavior instead of searching the front overlay.
	tell application "System Events"
		tell process "ChatGPT"
			try
				perform action "AXRaise" of appWindow
			end try
			try
				set value of attribute "AXMain" of appWindow to true
			end try
			try
				set value of attribute "AXFocused" of appWindow to true
			end try
			set frontmost to true
			key code 53
			delay 0.15
			set focusedElement to value of attribute "AXFocusedUIElement"
		end tell
	end tell
	if my isComposerElement(focusedElement, appWindow) then return focusedElement
	set composerElement to my composerNearFocusedElement(focusedElement, appWindow)
	if composerElement is missing value then set composerElement to my composerInBottomRegion(appWindow, appWindow, 12)
	if composerElement is missing value then error "Codex composer is not available"
	my focusElement(composerElement)
	return composerElement
end focusedComposer

on focusElement(uiElement)
	tell application "System Events"
		tell process "ChatGPT"
			set value of attribute "AXFocused" of uiElement to true
		end tell
	end tell
end focusElement

on elementValue(uiElement)
	tell application "System Events"
		tell process "ChatGPT"
			try
				return value of uiElement as text
			on error
				return ""
			end try
		end tell
	end tell
end elementValue

on isPlanModeActive(composerElement)
	tell application "System Events"
		tell process "ChatGPT"
			try
				set composerContainer to value of attribute "AXParent" of composerElement
				set composerContainer to value of attribute "AXParent" of composerContainer
				repeat with childElement in UI elements of composerContainer
					try
						if role of childElement is "AXButton" and description of childElement is "Plan" then return true
					end try
				end repeat
			end try
		end tell
	end tell
	return false
end isPlanModeActive

on waitForPlanMode(expectedState)
	repeat 15 times
		try
			set composerElement to my focusedComposer()
			if my isPlanModeActive(composerElement) is expectedState then return composerElement
		end try
		delay 0.1
	end repeat
	error "Codex did not change its Plan mode"
end waitForPlanMode

on enterModeCommand(modeCommand)
	repeat 3 times
		set composerElement to my focusedComposer()
		my focusElement(composerElement)
		tell application "System Events"
			keystroke "a" using {command down}
			keystroke modeCommand
		end tell
		delay 0.2
		try
			set composerElement to my focusedComposer()
			if my elementValue(composerElement) is modeCommand then return composerElement
		end try
		delay 0.15
	end repeat
	error "Codex mode command was not entered"
end enterModeCommand

on restoreDraft(pasteboard, draftText, clipboardMarker, fallbackComposer)
	if draftText is clipboardMarker then return fallbackComposer
	pasteboard's clearContents()
	pasteboard's setString:draftText forType:(current application's NSPasteboardTypeString)
	try
		set composerElement to my focusedComposer()
	on error
		my focusElement(fallbackComposer)
		set composerElement to my focusedComposer()
	end try
	my focusElement(composerElement)
	delay 0.05
	tell application "System Events"
		keystroke "a" using {command down}
		keystroke "v" using {command down}
	end tell
	delay 0.2
	try
		set composerElement to my focusedComposer()
	end try
	return composerElement
end restoreDraft

on toggleSlashMode(modeCommand)
	set clipboardMarker to "__CHATGATO_EMPTY_DRAFT_5A3167C8__"
	set pasteboard to current application's NSPasteboard's generalPasteboard()
	set savedItems to my copyPasteboardItems(pasteboard)
	set composerElement to my focusedComposer()
	set draftText to clipboardMarker
	try
		pasteboard's clearContents()
		pasteboard's setString:clipboardMarker forType:(current application's NSPasteboardTypeString)
		tell application "System Events"
			keystroke "a" using {command down}
			keystroke "x" using {command down}
		end tell
		delay 0.1
		set draftText to pasteboard's stringForType:(current application's NSPasteboardTypeString)
		if draftText is missing value then set draftText to clipboardMarker
		set composerElement to my focusedComposer()

		set composerElement to my enterModeCommand(modeCommand)
		tell application "System Events" to key code 36
		delay 0.35
		-- The first Return can accept the slash suggestion. Submit once more only
		-- when the command is still present in the composer.
		set modeCommandStillPresent to false
		try
			set composerElement to my focusedComposer()
			set modeCommandStillPresent to my elementValue(composerElement) is modeCommand
		end try
		if modeCommandStillPresent then
			tell application "System Events" to key code 36
			delay 0.35
		end if
		set modeCommandStillPresent to false
		try
			set composerElement to my focusedComposer()
			set modeCommandStillPresent to my elementValue(composerElement) is modeCommand
		end try
		if modeCommandStillPresent then error "Codex mode command was not submitted"

		set composerElement to my restoreDraft(pasteboard, draftText, clipboardMarker, composerElement)
	on error errorMessage number errorNumber
		try
			set composerElement to my restoreDraft(pasteboard, draftText, clipboardMarker, composerElement)
		end try
		my restorePasteboardItems(pasteboard, savedItems)
		error errorMessage number errorNumber
	end try
	my restorePasteboardItems(pasteboard, savedItems)
end toggleSlashMode

on exitPlanMode()
	set composerElement to my focusedComposer()
	if not my isPlanModeActive(composerElement) then error "Plan mode is not active in the current composer"
	set draftText to my elementValue(composerElement)
	my focusElement(composerElement)
	delay 0.05
	tell application "System Events"
		-- Codex's desktop composer exits Plan when Backspace is pressed at offset 0.
		key code 126 using {command down}
		delay 0.05
		set selectedRange to value of attribute "AXSelectedTextRange" of composerElement
		if (item 1 of selectedRange) is not 1 or (item 2 of selectedRange) is not 0 then error "Could not safely position the Plan-mode caret"
		key code 51
	end tell
	set composerElement to my waitForPlanMode(false)
	repeat 10 times
		if my elementValue(composerElement) is draftText then return
		delay 0.1
		set composerElement to my focusedComposer()
	end repeat
	error "Codex draft changed while disabling Plan mode"
end exitPlanMode

on enablePlanMode()
	set composerElement to my focusedComposer()
	if not my isPlanModeActive(composerElement) then my toggleSlashMode("/plan")
	my waitForPlanMode(true)
end enablePlanMode

on toggleCurrentPlanMode()
	set composerElement to my focusedComposer()
	if my isPlanModeActive(composerElement) then
		my exitPlanMode()
		return "off"
	end if
	my enablePlanMode()
	return "on"
end toggleCurrentPlanMode

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

	tell application "System Events" to set chatGPTIsFrontmost to frontmost of process "ChatGPT"
	if not chatGPTIsFrontmost then tell application "ChatGPT" to activate
	delay 0.35

	if controlMode is "mode" then
		if payload is "fastOn" or payload is "fastOff" then
			my toggleSlashMode("/fast")
			return
		else if payload is "planOn" then
			my enablePlanMode()
			return "on"
		else if payload is "planOff" then
			set composerElement to my focusedComposer()
			if my isPlanModeActive(composerElement) then my exitPlanMode()
			my waitForPlanMode(false)
			return "off"
		else if payload is "planToggle" then
			return my toggleCurrentPlanMode()
		else
			error "Unknown Codex mode: " & payload
		end if
	end if

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
