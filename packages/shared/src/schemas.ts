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
