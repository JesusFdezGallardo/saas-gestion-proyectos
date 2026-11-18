/** Settings shared by the Playwright config and the helper scripts. Everything is overridable. */
export const PORT = Number(process.env.E2E_PORT ?? 3130);
export const ORIGIN = `http://localhost:${PORT}`;
const DB_NAME = process.env.E2E_DB_NAME ?? 'kanban_e2e';
const OWNER = process.env.E2E_OWNER_URL ?? 'postgres://postgres:postgres@localhost:5432';
const APP = process.env.E2E_APP_URL ?? 'postgres://app_user:app_user@localhost:5432';

export const DB = {
  name: DB_NAME,
  /** Server connection with the owner role, to the maintenance database (create/drop). */
  adminUrl: `${OWNER}/postgres`,
  ownerUrl: `${OWNER}/${DB_NAME}`,
  appUrl: `${APP}/${DB_NAME}`,
};
