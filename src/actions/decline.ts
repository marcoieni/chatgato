import { action } from "@elgato/streamdeck";
import { DedicatedCommandAction } from "./dedicated-command.js";

@action({ UUID: "com.marco.chatgato.decline" })
export class DeclineAction extends DedicatedCommandAction {
  constructor() {
    super("decline", "Decline");
  }
}
