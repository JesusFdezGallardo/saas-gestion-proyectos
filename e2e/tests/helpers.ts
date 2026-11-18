import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

export const PROJECT = 'Web corporativa';

/** A signed-in user with their own browser context (own cookies), looking at the demo board. */
export interface Session {
  context: BrowserContext;
  page: Page;
}

/** Opens a fresh context, signs in with the demo button and lands on the project's board. */
export async function openBoard(browser: Browser, firstName: string): Promise<Session> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/entrar');
  await enterBoard(page, firstName);
  return { context, page };
}

/** On the login page: signs in with the demo button and opens the project's board. */
export async function enterBoard(page: Page, firstName: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`Entrar como ${firstName}`) }).click();
  await page.getByRole('link', { name: new RegExp(PROJECT) }).click();
  await expect(page.getByRole('heading', { level: 1, name: PROJECT })).toBeVisible();
  // The columns are there once the board has loaded.
  await expect(column(page, 'Por hacer')).toBeVisible();
  // Events only arrive once the socket has joined the board's room.
  await expect(page.locator('body')).toHaveAttribute('data-realtime', 'joined');
}

/** A column (a `section` named after its heading, e.g. "Por hacer 3 , 3 tarjetas…"). */
export const column = (page: Page, name: string): Locator =>
  page.getByRole('region', { name: new RegExp(`^${escapeRegExp(name)}(?![\\wÀ-ÿ])`) });

/** A card inside a column (cards are draggable buttons named after their title). */
export const cardIn = (col: Locator, title: string): Locator =>
  col.getByRole('button', { name: title });

/** A unique title per run, so a spec never trips over cards or columns of another one. */
export const unique = (label: string): string => `${label} ${Date.now().toString(36)}`;

export async function addCard(col: Locator, title: string): Promise<void> {
  await col.getByRole('button', { name: '+ tarjeta' }).click();
  const input = col.getByLabel('Título de la nueva tarjeta');
  await input.fill(title);
  await input.press('Enter');
  await expect(cardIn(col, title)).toBeVisible();
}

/** Names of the columns on screen, left to right. */
export async function columnNames(page: Page): Promise<string[]> {
  const handles = await page.getByRole('button', { name: /^Mover la columna «/ }).all();
  const labels = await Promise.all(handles.map((h) => h.getAttribute('aria-label')));
  return labels.map((l) => /«(.*)»/.exec(l ?? '')?.[1] ?? '');
}

/**
 * Drags with real mouse moves (dnd-kit's mouse sensor needs the pointer to travel first) and
 * drops over the top of the target column's list, just below its header.
 */
export async function dragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Nothing to drag, or nowhere to drop it');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(to.height / 2, 90), { steps: 20 });
  await page.mouse.up();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
