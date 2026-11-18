import { expect, test, type Page } from '@playwright/test';
import { addCard, cardIn, column, openBoard, unique } from './helpers';

const bell = (page: Page) => page.getByRole('button', { name: /^Notificaciones/ });

/** Unread count from the bell's accessible name ("Notificaciones, 3 sin leer"). */
async function unread(page: Page): Promise<number> {
  const label = await bell(page).getAttribute('aria-label');
  return Number(/(\d+) sin leer/.exec(label ?? '')?.[1] ?? 0);
}

test('mentioning Luis raises his bell and leaves an email in "Mi buzón"', async ({ browser }) => {
  const ana = await openBoard(browser, 'Ana');
  const luis = await openBoard(browser, 'Luis');
  const title = unique('Tarjeta con mención');
  const before = await unread(luis.page);

  await addCard(column(ana.page, 'Por hacer'), title);
  await cardIn(column(ana.page, 'Por hacer'), title).click();
  const dialog = ana.page.getByRole('dialog');
  const box = dialog.getByLabel('Escribe un comentario');
  await box.fill('Hola @Lu');
  await ana.page.getByRole('listbox').getByRole('option', { name: 'Luis García' }).click();
  await expect(box).toHaveValue(/@\[Luis García\]\(user:[\w-]+\) $/);
  // The input puts the caret back after the mention on the next frame: let it, then type.
  await ana.page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await box.pressSequentially('esto es para ti');
  await dialog.getByRole('button', { name: 'Comentar' }).click();
  await expect(dialog.getByText('esto es para ti')).toBeVisible();

  // The bell goes up by one in real time, with no reload.
  await expect(bell(luis.page)).toHaveAttribute(
    'aria-label',
    `Notificaciones, ${before + 1} sin leer`,
  );

  // The email is queued and written by the worker a moment later: look again until it is there.
  await luis.page.goto('/buzon');
  const mail = luis.page
    .getByRole('list', { name: 'Correos' })
    .getByRole('listitem')
    .filter({ hasText: 'te ha mencionado' })
    .filter({ hasText: title });
  await expect(async () => {
    await luis.page.getByRole('button', { name: /Actualizar/ }).click();
    await expect(mail).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(mail.getByText('Solo buzón (demo)')).toBeVisible();

  await ana.context.close();
  await luis.context.close();
});
