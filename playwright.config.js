import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 8787);

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  globalSetup: "./test/browser/global-setup.mjs",

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: `node test/browser/server.mjs`,
    url: `http://localhost:${PORT}/test/browser/harness.html`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
    stdout: "ignore",
    stderr: "pipe",
  },
});
