/** Settings shared by the Playwright config and the helper scripts. Everything is overridable. */
export const PORT = Number(process.env.E2E_PORT ?? 3130);
export const ORIGIN = `http://localhost:${PORT}`;
/** Same value as `DEMO_RESET_TOKEN` in `scripts/serve.mjs` (a throwaway local secret). */
export const DEMO_RESET_TOKEN = 'e2e-reset-token-e2e-reset-token-00';
