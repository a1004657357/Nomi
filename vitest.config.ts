import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["electron/**/*.test.ts", "src/**/*.test.ts", "evals/**/*.test.ts", "scripts/**/*.test.mjs", "tests/**/*.test.mjs"],
    environment: "node",
    // Production-run tests exercise real filesystem journals and async gates.
    // The custom suite is large enough that Vitest's 5s default flakes under
    // worker contention even though isolated runs complete in 1-4 seconds.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      // node 单测不得加载真 electron 运行时（import 即抛"failed to install"）。
      // 统一指向无副作用的桩；真实构建走 vite.config.ts，不受影响。
      electron: fileURLToPath(new URL("./tests/stubs/electron.ts", import.meta.url)),
    },
  },
});
