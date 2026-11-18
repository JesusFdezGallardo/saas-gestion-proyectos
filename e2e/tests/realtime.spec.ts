import { expect, test } from '@playwright/test';
import { addCard, cardIn, column, dragTo, openBoard, unique } from './helpers';

test('a card Ana moves shows up in its new column on Luis screen without reloading', async ({
  browser,
}) => {
  const ana = await openBoard(browser, 'Ana');
  const luis = await openBoard(browser, 'Luis');
  const title = unique('Tarjeta en vivo');

  // Creating is already live: Luis gets the card in "Por hacer" with no reload.
  await addCard(column(ana.page, 'Por hacer'), title);
  await expect(cardIn(column(luis.page, 'Por hacer'), title)).toBeVisible({ timeout: 3000 });

  await dragTo(
    ana.page,
    cardIn(column(ana.page, 'Por hacer'), title),
    column(ana.page, 'En curso'),
  );
  await expect(cardIn(column(ana.page, 'En curso'), title)).toBeVisible();

  // The point of the test: Luis sees it in "En curso" within 3 s, and not in "Por hacer" any more.
  await expect(cardIn(column(luis.page, 'En curso'), title)).toBeVisible({ timeout: 3000 });
  await expect(cardIn(column(luis.page, 'Por hacer'), title)).toHaveCount(0);

  await ana.context.close();
  await luis.context.close();
});
