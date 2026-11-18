import { positionBetween, type LabelColor } from '@kanban/shared';
import { systemDb, type AppDb } from '../../db/client';
import {
  cardLabels,
  cards,
  columns,
  comments,
  labels,
  memberships,
  mentions,
  notifications,
  organizations,
  projects,
  userSettings,
  users,
} from '../../db/schema';

/** What `seedDemo` needs from a database handle: works with the pool and with a transaction. */
export type SeedDb = Pick<AppDb, 'insert'>;

type Role = 'admin' | 'member';

interface CardSeed {
  title: string;
  description?: string;
  /** Index into the project's columns. */
  col: number;
  assignee?: string;
  /** Days from today (negative = overdue). */
  due?: number;
  labels?: string[];
}

interface ProjectSeed {
  name: string;
  columns: string[];
  /** Colours from `LABEL_COLORS`, the palette the label editor offers. */
  labels: Array<[name: string, color: LabelColor]>;
  cards: CardSeed[];
}

const DAY_MS = 24 * 3600 * 1000;

/** `YYYY-MM-DD`, `offset` days from today (UTC). */
function dateIn(offset: number): string {
  return new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
}

const mention = (name: string, id: string): string => `@[${name}](user:${id})`;

const WEB: ProjectSeed = {
  name: 'Web corporativa',
  columns: ['Por hacer', 'En curso', 'En revisión', 'Hecho'],
  labels: [
    ['Diseño', '#8b5cf6'],
    ['Desarrollo', '#3b82f6'],
    ['Contenido', '#22c55e'],
    ['Urgente', '#ef4444'],
    ['Cliente', '#eab308'],
  ],
  cards: [
    {
      title: 'Definir el mapa del sitio',
      description: 'Páginas principales, jerarquía de navegación y enlaces del pie.',
      col: 3,
      assignee: 'ana',
      due: -6,
      labels: ['Contenido'],
    },
    {
      title: 'Diseñar la página de inicio',
      description: 'Versión de escritorio y móvil. Hero con el vídeo del estudio.',
      col: 2,
      assignee: 'marta',
      due: 2,
      labels: ['Diseño', 'Cliente'],
    },
    {
      title: 'Maquetar el portafolio de proyectos',
      description: 'Rejilla con filtros por categoría y ficha de cada proyecto.',
      col: 1,
      assignee: 'luis',
      due: 5,
      labels: ['Desarrollo'],
    },
    {
      title: 'Redactar los textos de «Sobre nosotros»',
      col: 1,
      assignee: 'ana',
      due: 7,
      labels: ['Contenido'],
    },
    {
      title: 'Optimizar las imágenes para web',
      description: 'Convertir a WebP y definir tamaños responsive.',
      col: 0,
      assignee: 'luis',
      due: 10,
      labels: ['Desarrollo'],
    },
    {
      title: 'Formulario de contacto con validación',
      col: 0,
      due: 12,
      labels: ['Desarrollo', 'Cliente'],
    },
    {
      title: 'Corregir el menú en pantallas pequeñas',
      description: 'El desplegable tapa el logotipo por debajo de 360 px.',
      col: 0,
      assignee: 'luis',
      due: 1,
      labels: ['Desarrollo', 'Urgente'],
    },
  ],
};

const NAVIDAD: ProjectSeed = {
  name: 'Campaña de Navidad',
  columns: ['Ideas', 'En producción', 'Publicado'],
  labels: [
    ['Redes sociales', '#ec4899'],
    ['Email', '#3b82f6'],
    ['Vídeo', '#8b5cf6'],
    ['Presupuesto', '#f97316'],
    ['Urgente', '#ef4444'],
  ],
  cards: [
    {
      title: 'Lema y concepto de la campaña',
      description: 'Tres propuestas para presentar al cliente el lunes.',
      col: 2,
      assignee: 'ana',
      due: -10,
    },
    {
      title: 'Calendario de publicaciones en Instagram',
      col: 1,
      assignee: 'marta',
      due: 4,
      labels: ['Redes sociales'],
    },
    {
      title: 'Spot de 20 segundos para redes',
      description: 'Guion cerrado; falta grabar y montar.',
      col: 1,
      assignee: 'luis',
      due: 9,
      labels: ['Vídeo', 'Redes sociales'],
    },
    {
      title: 'Plantilla del boletín navideño',
      col: 0,
      assignee: 'marta',
      due: 14,
      labels: ['Email'],
    },
    {
      title: 'Ajustar el presupuesto de impresión',
      description: 'Pedir tres presupuestos de cartelería y comparar.',
      col: 0,
      due: 3,
      labels: ['Presupuesto', 'Urgente'],
    },
  ],
};

const APP_INTERNA: ProjectSeed = {
  name: 'App interna',
  columns: ['Pendiente', 'En curso', 'Hecho'],
  labels: [
    ['Backend', '#3b82f6'],
    ['Frontend', '#8b5cf6'],
    ['Bug', '#ef4444'],
  ],
  cards: [
    {
      title: 'Importar el catálogo de productos',
      col: 2,
      assignee: 'pablo',
      due: -4,
      labels: ['Backend'],
    },
    {
      title: 'Pantalla de inventario',
      description: 'Listado con búsqueda y ajuste de existencias.',
      col: 1,
      assignee: 'pablo',
      due: 6,
      labels: ['Frontend'],
    },
    { title: 'Informe semanal de ventas', col: 1, due: 8, labels: ['Backend'] },
    {
      title: 'Error al exportar a Excel',
      description: 'Las tildes salen mal en el archivo descargado.',
      col: 0,
      assignee: 'pablo',
      due: 2,
      labels: ['Bug'],
    },
    { title: 'Permisos por departamento', col: 0, labels: ['Backend'] },
    { title: 'Modo oscuro', col: 0, due: 20, labels: ['Frontend'] },
  ],
};

interface Seeded {
  projectId: string;
  columnIds: string[];
  cardIds: string[];
}

/**
 * Loads the demo organisations, users and boards. Deterministic (fixed content; due dates are
 * relative to today so the board never looks stale). Call it on an empty database: `resetDemo`
 * truncates first. Pass a transaction to make it atomic with the truncate.
 */
export async function seedDemo(db: SeedDb = systemDb): Promise<void> {
  const people: Array<[key: string, email: string, name: string]> = [
    ['ana', 'ana@demo.local', 'Ana López'],
    ['luis', 'luis@demo.local', 'Luis García'],
    ['marta', 'marta@demo.local', 'Marta Ruiz'],
    ['pablo', 'pablo@demo.local', 'Pablo Sanz'],
  ];
  const userRows = await db
    .insert(users)
    .values(people.map(([, email, name]) => ({ email, name, isDemo: true })))
    .returning({ id: users.id, email: users.email });
  const uid: Record<string, string> = {};
  const names: Record<string, string> = {};
  for (const [key, email, name] of people) {
    const row = userRows.find((u) => u.email === email);
    if (!row) throw new Error(`seed: user ${email} was not inserted`);
    uid[key] = row.id;
    names[key] = name;
  }
  await db.insert(userSettings).values(userRows.map((u) => ({ userId: u.id })));

  const orgRows = await db
    .insert(organizations)
    .values([
      { name: 'Estudio Acme', isDemo: true },
      { name: 'Otra Empresa', isDemo: true },
    ])
    .returning({ id: organizations.id, name: organizations.name });
  const acme = orgRows.find((o) => o.name === 'Estudio Acme')!.id;
  const otra = orgRows.find((o) => o.name === 'Otra Empresa')!.id;

  const member = (organizationId: string, key: string, role: Role) => ({
    organizationId,
    userId: uid[key]!,
    role,
  });
  await db
    .insert(memberships)
    .values([
      member(acme, 'ana', 'admin'),
      member(acme, 'luis', 'member'),
      member(acme, 'marta', 'member'),
      member(otra, 'pablo', 'admin'),
    ]);

  async function seedProject(
    organizationId: string,
    createdBy: string,
    seed: ProjectSeed,
  ): Promise<Seeded> {
    const [project] = await db
      .insert(projects)
      .values({ organizationId, name: seed.name })
      .returning({ id: projects.id });
    const projectId = project!.id;

    let prev: string | null = null;
    const columnValues = seed.columns.map((name) => {
      prev = positionBetween(prev, null);
      return { organizationId, projectId, name, position: prev };
    });
    const columnRows = await db.insert(columns).values(columnValues).returning({ id: columns.id });
    // `returning` keeps the insertion order of a single multi-row insert.
    const columnIds = columnRows.map((c) => c.id);

    const labelRows = await db
      .insert(labels)
      .values(seed.labels.map(([name, color]) => ({ organizationId, projectId, name, color })))
      .returning({ id: labels.id, name: labels.name });
    const labelId = new Map(labelRows.map((l) => [l.name, l.id]));

    const lastInColumn = new Map<number, string>();
    const cardValues = seed.cards.map((c) => {
      const position = positionBetween(lastInColumn.get(c.col) ?? null, null);
      lastInColumn.set(c.col, position);
      return {
        organizationId,
        projectId,
        columnId: columnIds[c.col]!,
        title: c.title,
        description: c.description ?? '',
        assigneeId: c.assignee ? uid[c.assignee]! : null,
        dueDate: c.due === undefined ? null : dateIn(c.due),
        position,
        createdBy,
      };
    });
    const cardRows = await db.insert(cards).values(cardValues).returning({ id: cards.id });
    const cardIds = cardRows.map((c) => c.id);

    const links = seed.cards.flatMap((c, i) =>
      (c.labels ?? []).map((name) => {
        const id = labelId.get(name);
        if (!id) throw new Error(`seed: unknown label ${name}`);
        return { organizationId, cardId: cardIds[i]!, labelId: id };
      }),
    );
    if (links.length > 0) await db.insert(cardLabels).values(links);
    return { projectId, columnIds, cardIds };
  }

  const web = await seedProject(acme, uid.ana!, WEB);
  const navidad = await seedProject(acme, uid.ana!, NAVIDAD);
  await seedProject(otra, uid.pablo!, APP_INTERNA);

  // Comments with mentions (one hour apart, oldest first), the mentions table and the matching
  // notifications.
  const base = Date.now() - 6 * 3600 * 1000;
  const at = (i: number) => new Date(base + i * 3600 * 1000);
  const commentSeeds: Array<{
    cardId: string;
    author: string;
    body: string;
    mentioned: string;
  }> = [
    {
      cardId: web.cardIds[1]!,
      author: 'ana',
      mentioned: 'marta',
      body: `${mention(names.marta!, uid.marta!)} ¿puedes subir la primera versión de la portada antes del jueves? El cliente quiere verla.`,
    },
    {
      cardId: web.cardIds[2]!,
      author: 'marta',
      mentioned: 'luis',
      body: `${mention(names.luis!, uid.luis!)} los filtros del portafolio van mejor como botones que como desplegable, ¿lo vemos?`,
    },
    {
      cardId: web.cardIds[6]!,
      author: 'luis',
      mentioned: 'ana',
      body: `${mention(names.ana!, uid.ana!)} ya lo he reproducido en un móvil pequeño; lo arreglo hoy y te aviso.`,
    },
    {
      cardId: navidad.cardIds[2]!,
      author: 'ana',
      mentioned: 'luis',
      body: `${mention(names.luis!, uid.luis!)} el guion está aprobado. ¿Cuándo puedes empezar el montaje?`,
    },
  ];
  const commentRows = await db
    .insert(comments)
    .values(
      commentSeeds.map((c, i) => ({
        organizationId: acme,
        cardId: c.cardId,
        authorId: uid[c.author]!,
        body: c.body,
        createdAt: at(i),
      })),
    )
    .returning({ id: comments.id });
  await db.insert(mentions).values(
    commentSeeds.map((c, i) => ({
      organizationId: acme,
      commentId: commentRows[i]!.id,
      userId: uid[c.mentioned]!,
    })),
  );
  await db.insert(notifications).values([
    ...commentSeeds.map((c, i) => ({
      organizationId: acme,
      userId: uid[c.mentioned]!,
      type: 'mention' as const,
      actorId: uid[c.author]!,
      cardId: c.cardId,
      commentId: commentRows[i]!.id,
      // The first one is already read so the bell shows a mix.
      readAt: i === 0 ? at(i + 1) : null,
      createdAt: at(i),
    })),
    {
      organizationId: acme,
      userId: uid.luis!,
      type: 'assigned' as const,
      actorId: uid.ana!,
      cardId: web.cardIds[4]!,
      commentId: null,
      readAt: null,
      createdAt: at(5),
    },
  ]);
}
