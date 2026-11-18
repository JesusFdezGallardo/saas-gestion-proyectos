import { expect, test } from '@playwright/test';
import { DEMO_RESET_TOKEN } from '../env';
import { addCard, cardIn, column, dragTo, enterBoard, openBoard, unique } from './helpers';

test('after a demo reset both users sign in again and live updates still arrive', async ({
  browser,
  request,
}) => {
  const ana = await openBoard(browser, 'Ana');
  const luis = await openBoard(browser, 'Luis');

  const res = await request.post('/internal/demo/reset', {
    headers: { Authorization: `Bearer ${DEMO_RESET_TOKEN}` },
  });
  expect(res.status()).toBe(204);

  // Both tabs hear `demo:reset`, find their session gone and go to the login page.
  for (const s of [ana, luis]) {
    await expect(s.page).toHaveURL(/\/entrar\?motivo=reinicio$/);
    await expect(s.page.getByText('La demo se ha reiniciado. Vuelve a entrar.')).toBeVisible();
  }

  // Signing in again (no reload): the new socket handshakes with the new session.
  await enterBoard(luis.page, 'Luis');
  await enterBoard(ana.page, 'Ana');

  const title = unique('Tras reiniciar');
  await addCard(column(ana.page, 'Por hacer'), title);
  await expect(cardIn(column(luis.page, 'Por hacer'), title)).toBeVisible({ timeout: 3000 });
  await dragTo(
    ana.page,
    cardIn(column(ana.page, 'Por hacer'), title),
    column(ana.page, 'En curso'),
  );
  await expect(cardIn(column(luis.page, 'En curso'), title)).toBeVisible({ timeout: 3000 });

  await ana.context.close();
  await luis.context.close();
});
