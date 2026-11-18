import { defineConfig } from 'vitest/config';

const testOwnerUrl =
  process.env.TEST_DATABASE_URL_OWNER ?? 'postgres://postgres:postgres@localhost:5432/kanban_test';
const testAppUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://app_user:app_user@localhost:5432/kanban_test';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Every test file shares one database: run files one after another.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testAppUrl,
      DATABASE_URL_OWNER: testOwnerUrl,
    },
  },
});
