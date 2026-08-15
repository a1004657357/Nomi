import { ipcMain } from "electron";

import {
  readAutomationPolicySettings,
  writeAutomationPolicySettings,
  type AutomationPolicySettings,
} from "./automationPolicySettings";

export type AutomationPolicySettingsStore = {
  read: () => AutomationPolicySettings;
  write: (value: unknown) => AutomationPolicySettings;
};

export function registerAutomationPolicyIpc(
  store: AutomationPolicySettingsStore = {
    read: readAutomationPolicySettings,
    write: writeAutomationPolicySettings,
  },
): void {
  ipcMain.handle("nomi:settings:automation-policy-get", async () => store.read());
  ipcMain.handle("nomi:settings:automation-policy-set", async (_event, payload: unknown) => store.write(payload));
}
