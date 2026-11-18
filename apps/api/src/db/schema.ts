import {
  boolean,
  customType,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/** Case-insensitive text (extension created in the first migration). */
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const orgId = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

export const membershipRole = pgEnum('membership_role', ['admin', 'member']);
export const notificationType = pgEnum('notification_type', ['mention', 'assigned', 'comment']);
export const mailStatus = pgEnum('mail_status', [
  'stored',
  'sent',
  'skipped_demo',
  'skipped_limit',
  'skipped_blocked',
  'failed',
]);
export const quotaScope = pgEnum('quota_scope', ['recipient', 'inviter', 'global']);

// ---------------------------------------------------------------- global (no RLS)

export const users = pgTable('users', {
  id: id(),
  email: citext('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** sha256 (hex) of the session token; the token itself is never stored. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

// ---------------------------------------------------------------- organizations

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    organizationId: orgId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('memberships_org_user_uq').on(t.organizationId, t.userId),
    index('memberships_user_id_idx').on(t.userId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    organizationId: orgId(),
    email: citext('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('invitations_org_idx').on(t.organizationId)],
);

// ---------------------------------------------------------------- tenant data
//
// Children reference their parent with a composite (id, organization_id) foreign key, so a
// row can never point to a parent in another organization, even if code passes a foreign id.

export const projects = pgTable(
  'projects',
  {
    id: id(),
    organizationId: orgId(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('projects_org_idx').on(t.organizationId),
    unique('projects_id_org_uq').on(t.id, t.organizationId),
  ],
);

export const columns = pgTable(
  'columns',
  {
    id: id(),
    organizationId: orgId(),
    projectId: uuid('project_id').notNull(),
    name: text('name').notNull(),
    position: text('position').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('columns_org_idx').on(t.organizationId),
    index('columns_project_position_idx').on(t.projectId, t.position),
    unique('columns_id_org_uq').on(t.id, t.organizationId),
    foreignKey({
      name: 'columns_project_fk',
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete('cascade'),
  ],
);

export const cards = pgTable(
  'cards',
  {
    id: id(),
    organizationId: orgId(),
    projectId: uuid('project_id').notNull(),
    columnId: uuid('column_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    dueDate: date('due_date'),
    position: text('position').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('cards_org_idx').on(t.organizationId),
    index('cards_column_position_idx').on(t.columnId, t.position),
    index('cards_project_idx').on(t.projectId),
    unique('cards_id_org_uq').on(t.id, t.organizationId),
    foreignKey({
      name: 'cards_project_fk',
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'cards_column_fk',
      columns: [t.columnId, t.organizationId],
      foreignColumns: [columns.id, columns.organizationId],
    }).onDelete('cascade'),
  ],
);

export const labels = pgTable(
  'labels',
  {
    id: id(),
    organizationId: orgId(),
    projectId: uuid('project_id').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('labels_org_idx').on(t.organizationId),
    index('labels_project_idx').on(t.projectId),
    unique('labels_id_org_uq').on(t.id, t.organizationId),
    foreignKey({
      name: 'labels_project_fk',
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete('cascade'),
  ],
);

export const cardLabels = pgTable(
  'card_labels',
  {
    organizationId: orgId(),
    cardId: uuid('card_id').notNull(),
    labelId: uuid('label_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'card_labels_pk', columns: [t.cardId, t.labelId] }),
    index('card_labels_org_idx').on(t.organizationId),
    index('card_labels_label_idx').on(t.labelId),
    foreignKey({
      name: 'card_labels_card_fk',
      columns: [t.cardId, t.organizationId],
      foreignColumns: [cards.id, cards.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'card_labels_label_fk',
      columns: [t.labelId, t.organizationId],
      foreignColumns: [labels.id, labels.organizationId],
    }).onDelete('cascade'),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: id(),
    organizationId: orgId(),
    cardId: uuid('card_id').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('comments_org_idx').on(t.organizationId),
    index('comments_card_idx').on(t.cardId, t.createdAt),
    unique('comments_id_org_uq').on(t.id, t.organizationId),
    foreignKey({
      name: 'comments_card_fk',
      columns: [t.cardId, t.organizationId],
      foreignColumns: [cards.id, cards.organizationId],
    }).onDelete('cascade'),
  ],
);

export const mentions = pgTable(
  'mentions',
  {
    id: id(),
    organizationId: orgId(),
    commentId: uuid('comment_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('mentions_comment_user_uq').on(t.commentId, t.userId),
    index('mentions_org_idx').on(t.organizationId),
    foreignKey({
      name: 'mentions_comment_fk',
      columns: [t.commentId, t.organizationId],
      foreignColumns: [comments.id, comments.organizationId],
    }).onDelete('cascade'),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    organizationId: orgId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id').notNull(),
    commentId: uuid('comment_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_org_idx').on(t.organizationId),
    index('notifications_user_read_idx').on(t.userId, t.readAt),
    foreignKey({
      name: 'notifications_card_fk',
      columns: [t.cardId, t.organizationId],
      foreignColumns: [cards.id, cards.organizationId],
    }).onDelete('cascade'),
    // MATCH SIMPLE: not checked while comment_id is null.
    foreignKey({
      name: 'notifications_comment_fk',
      columns: [t.commentId, t.organizationId],
      foreignColumns: [comments.id, comments.organizationId],
    }).onDelete('cascade'),
  ],
);

// ---------------------------------------------------------------- per user

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  emailNotifications: boolean('email_notifications').notNull().default(true),
});

// ---------------------------------------------------------------- mail (system, no RLS)

export const mailbox = pgTable(
  'mailbox',
  {
    id: id(),
    toEmail: citext('to_email').notNull(),
    subject: text('subject').notNull(),
    html: text('html').notNull(),
    text: text('text').notNull(),
    status: mailStatus('status').notNull().default('stored'),
    createdAt: createdAt(),
  },
  (t) => [index('mailbox_to_email_idx').on(t.toEmail, t.createdAt)],
);

export const emailQuota = pgTable(
  'email_quota',
  {
    day: date('day').notNull(),
    scope: quotaScope('scope').notNull(),
    key: text('key').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ name: 'email_quota_pk', columns: [t.day, t.scope, t.key] })],
);

export const emailBlocklist = pgTable('email_blocklist', {
  email: citext('email').primaryKey(),
  createdAt: createdAt(),
});

export const demoState = pgTable('demo_state', {
  id: integer('id').primaryKey().default(1),
  lastResetAt: timestamp('last_reset_at', { withTimezone: true }),
});
