import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Suites such as unit/zed-native-auth.test.js and unit/kimchi.test.js persist real
// connections through the app's DB layer instead of mocking it. Pointed at the default
// data dir those land in the live ~/.9router/db/data.sqlite as junk provider connections
// (they show up active in the dashboard and get picked for rotation). Give every run its
// own throwaway data dir so the suite can never touch live state.
const testDataDir = mkdtempSync(resolve(tmpdir(), "9router-tests-"));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.js"],
    // Don't scan into git worktrees nested under .claude/ — they carry their
    // own copies of the test files but lack an installed node_modules (open-sse,
    // etc.), which makes provider imports fail during collection.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**"],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // Suppress noisy console output from handlers under test
    silent: false,
    // Keep every run off the live data dir (see testDataDir above).
    env: { DATA_DIR: testDataDir },
  },
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});
