import path from "node:path";

import { readJsonFile, writeJsonFileAtomic } from "../jsonFile";
import {
  DEFAULT_AUTOMATION_POLICY_SETTINGS,
  normalizeAutomationPolicySettings,
  type AutomationPolicySettings,
} from "./automationPolicyContract";
import { getSettingsRoot } from "./settingsRoot";

const AUTOMATION_POLICY_FILE = "automation-policy.json";

export {
  DEFAULT_AUTOMATION_POLICY_SETTINGS,
  normalizeAutomationPolicySettings,
  type AutomationPolicySettings,
} from "./automationPolicyContract";

export function automationPolicySettingsPath(): string {
  return path.join(getSettingsRoot(), AUTOMATION_POLICY_FILE);
}

export function readAutomationPolicySettings(): AutomationPolicySettings {
  try {
    return normalizeAutomationPolicySettings(readJsonFile(automationPolicySettingsPath()));
  } catch {
    return normalizeAutomationPolicySettings(DEFAULT_AUTOMATION_POLICY_SETTINGS);
  }
}

export function writeAutomationPolicySettings(value: unknown): AutomationPolicySettings {
  const next = normalizeAutomationPolicySettings(value);
  writeJsonFileAtomic(automationPolicySettingsPath(), next);
  return next;
}
