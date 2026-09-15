import {defineConfig} from '@playwright/test';
import base from './playwright.config.js';
const {channel: _channel, ...use} = base.use ?? {};
export default defineConfig({
  ...base,
  use,
  testMatch: '**/syntax.spec.ts',
  outputDir: 'test-results/syntax-browsers',
  projects: [
    {name:'chromium',use:{browserName:'chromium',channel:'chrome'}},
    {name:'webkit',use:{browserName:'webkit',channel:undefined}},
  ],
});
