import path from "node:path";

export function isolatedElectronLaunchOptions(repoRoot, tempRoot, baseEnv = process.env) {
  const userDataDir = path.join(tempRoot, "user-data");
  const settingsDir = path.join(tempRoot, "settings");
  const projectsDir = path.join(tempRoot, "projects");
  const capabilityDir = path.join(tempRoot, "capability-core");
  return {
    args: [".", `--user-data-dir=${userDataDir}`],
    cwd: repoRoot,
    env: {
      ...baseEnv,
      NOMI_E2E: "1",
      NOMI_E2E_ALLOW_MULTI_INSTANCE: "1",
      NOMI_SOURCE_RUN: "1",
      NOMI_ELECTRON_USER_DATA_DIR: userDataDir,
      NOMI_SETTINGS_DIR: settingsDir,
      NOMI_PROJECTS_DIR: projectsDir,
      NOMI_CAPABILITY_DIR: capabilityDir,
    },
    paths: { userDataDir, settingsDir, projectsDir, capabilityDir },
  };
}
