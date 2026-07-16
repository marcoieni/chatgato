import { action } from "@elgato/streamdeck";
import { DedicatedCommandAction } from "./dedicated-command.js";

@action({ UUID: "com.marco.chatgato.approve" })
export class ApproveAction extends DedicatedCommandAction {
  constructor() {
    super("approve", "Approve");
  }
}
