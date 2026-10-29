import { defineConfig } from '@playwright/test';

const device = (width: number, height: number) => ({
  viewport: { width, height },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/artifacts',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173/crossword-builder/',
  },
  projects: [
    { name: 'cover-476x752', use: device(476, 752) },
    { name: 'inner-1164x878', use: device(1164, 878) },
    { name: 'phone-412x915', use: device(412, 915) },
  ],
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173/crossword-builder/',
    reuseExistingServer: !process.env.CI,
  },
});
