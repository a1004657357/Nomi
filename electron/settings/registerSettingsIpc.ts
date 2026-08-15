import { registerAutomationPolicyIpc } from "./automationPolicyIpc";
import { registerProjectLocationIpc } from "./projectLocationIpc";

export function registerSettingsIpc(): void {
  registerProjectLocationIpc();
  registerAutomationPolicyIpc();
}
