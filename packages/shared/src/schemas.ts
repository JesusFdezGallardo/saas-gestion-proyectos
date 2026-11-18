import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const RegisterInput = z.object({
  email,
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
  orgName: z.string().trim().min(1).max(100),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const MembershipRole = z.enum(['admin', 'member']);
export type MembershipRole = z.infer<typeof MembershipRole>;

export const MeDto = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    isDemo: z.boolean(),
  }),
  memberships: z.array(
    z.object({
      orgId: z.string(),
      orgName: z.string(),
      role: MembershipRole,
    }),
  ),
});
export type MeDto = z.infer<typeof MeDto>;

export const CreateOrgInput = z.object({ name: z.string().trim().min(1).max(100) });
export type CreateOrgInput = z.infer<typeof CreateOrgInput>;

export const UpdateMemberRoleInput = z.object({ role: MembershipRole });
export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleInput>;

export const InviteInput = z.object({ email });
export type InviteInput = z.infer<typeof InviteInput>;

export interface MemberDto {
  userId: string;
  name: string;
  email: string;
  role: MembershipRole;
}

export interface InvitationInfoDto {
  orgName: string;
  email: string;
  expired: boolean;
}

export const CreateProjectInput = z.object({ name: z.string().trim().min(1).max(100) });
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;
export const UpdateProjectInput = CreateProjectInput;
export type UpdateProjectInput = CreateProjectInput;

export const CreateColumnInput = z.object({ name: z.string().trim().min(1).max(60) });
export type CreateColumnInput = z.infer<typeof CreateColumnInput>;

export const UpdateColumnInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  beforeId: z.uuid().nullish(),
  afterId: z.uuid().nullish(),
});
export type UpdateColumnInput = z.infer<typeof UpdateColumnInput>;

export const LABEL_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;
export const LabelColor = z.enum(LABEL_COLORS);
export type LabelColor = z.infer<typeof LabelColor>;

const cardTitle = z.string().trim().min(1).max(200);
const cardDescription = z.string().max(5000);
const dueDate = z.iso.date();

export const CreateCardInput = z.object({
  title: cardTitle,
  description: cardDescription.optional(),
  assigneeId: z.uuid().nullish(),
  dueDate: dueDate.nullish(),
  labelIds: z.array(z.uuid()).max(50).optional(),
});
export type CreateCardInput = z.infer<typeof CreateCardInput>;

export const UpdateCardInput = z.object({
  title: cardTitle.optional(),
  description: cardDescription.optional(),
  assigneeId: z.uuid().nullable().optional(),
  dueDate: dueDate.nullable().optional(),
  labelIds: z.array(z.uuid()).max(50).optional(),
});
export type UpdateCardInput = z.infer<typeof UpdateCardInput>;

export const MoveCardInput = z.object({
  toColumnId: z.uuid(),
  beforeId: z.uuid().nullable(),
  afterId: z.uuid().nullable(),
});
export type MoveCardInput = z.infer<typeof MoveCardInput>;

export const CreateLabelInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: LabelColor,
});
export type CreateLabelInput = z.infer<typeof CreateLabelInput>;

export const UpdateLabelInput = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: LabelColor.optional(),
});
export type UpdateLabelInput = z.infer<typeof UpdateLabelInput>;

export interface ProjectDto {
  id: string;
  name: string;
  createdAt: string;
}

export interface ColumnDto {
  id: string;
  projectId: string;
  name: string;
  position: string;
}

export interface CardDto {
  id: string;
  projectId: string;
  columnId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: string | null;
  position: string;
  labelIds: string[];
  createdBy: string;
  commentCount: number;
}

export interface LabelDto {
  id: string;
  projectId: string;
  name: string;
  color: string;
}

export interface CommentDto {
  id: string;
  cardId: string;
  authorId: string;
  body: string;
  editedAt: string | null;
  createdAt: string;
}

export interface NotificationDto {
  id: string;
  orgId: string;
  type: 'mention' | 'assigned' | 'comment';
  actorId: string;
  cardId: string;
  commentId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface BoardMemberDto {
  userId: string;
  name: string;
}

export interface BoardDto {
  project: ProjectDto;
  columns: ColumnDto[];
  cards: CardDto[];
  labels: LabelDto[];
  members: BoardMemberDto[];
}
