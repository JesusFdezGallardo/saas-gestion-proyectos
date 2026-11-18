import { expect, test } from '@playwright/test';
import { addCard, cardIn, column, columnNames, dragTo, openBoard, unique } from './helpers';

test('Ana creates, renames, reorders and deletes a column, and Luis sees every step', async ({
  browser,
}) => {
  const ana = await openBoard(browser, 'Ana');
  const luis = await openBoard(browser, 'Luis');
  const name = unique('Revisión QA');
  const renamed = `${name} v2`;
  const card = unique('Tarjeta de columna');

  // Create
  await ana.page.getByRole('button', { name: '+ columna' }).click();
  await ana.page.getByLabel('Nombre de la nueva columna').fill(name);
  await ana.page.getByRole('button', { name: 'Añadir columna' }).click();
  await expect(column(ana.page, name)).toBeVisible();
  await expect(column(luis.page, name)).toBeVisible();
  await addCard(column(ana.page, name), card);
  await expect(cardIn(column(luis.page, name), card)).toBeVisible();

  // Rename
  await column(ana.page, name).getByRole('heading').getByRole('button').click();
  const input = ana.page.getByLabel('Nombre de la columna');
  await input.fill(renamed);
  await input.press('Enter');
  await expect(column(luis.page, renamed)).toBeVisible();
  await expect(luis.page.getByRole('button', { name: `Mover la columna «${name}»` })).toHaveCount(
    0,
  );

  // Reorder: drag the new (last) column's handle onto the handle of "Hecho", the one before it.
  expect((await columnNames(ana.page)).at(-1)).toBe(renamed);
  await dragTo(
    ana.page,
    ana.page.getByRole('button', { name: `Mover la columna «${renamed}»` }),
    ana.page.getByRole('button', { name: 'Mover la columna «Hecho»' }),
  );
  await expect
    .poll(async () => {
      const names = await columnNames(ana.page);
      return names.indexOf(renamed) === names.length - 2;
    })
    .toBe(true);
  const order = await columnNames(ana.page);
  await expect.poll(() => columnNames(luis.page)).toEqual(order);

  // Delete, moving its cards to "Por hacer"
  await ana.page.getByRole('button', { name: `Borrar la columna «${renamed}»` }).click();
  await ana.page.getByRole('dialog').getByRole('combobox').selectOption({ label: 'Por hacer' });
  await ana.page.getByRole('button', { name: 'Mover y borrar' }).click();
  await expect(column(luis.page, renamed)).toHaveCount(0);
  await expect(cardIn(column(luis.page, 'Por hacer'), card)).toBeVisible();
  await expect(cardIn(column(ana.page, 'Por hacer'), card)).toBeVisible();

  await ana.context.close();
  await luis.context.close();
});
