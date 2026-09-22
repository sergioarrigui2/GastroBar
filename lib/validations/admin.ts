import { z } from 'zod';

export const inventoryMovementSchema = z
  .object({
    ingredient_id: z.uuid(),
    type: z.enum(['waste', 'purchase', 'adjustment']),
    quantity: z.coerce.number().finite().refine((n) => n !== 0, 'La cantidad no puede ser 0'),
    reason: z.string().trim().max(200).optional(),
    unit_cost: z.coerce.number().finite().min(0).optional(),
  })
  .refine((v) => v.type === 'adjustment' || v.quantity > 0, {
    message: 'La cantidad debe ser positiva',
    path: ['quantity'],
  })
  .refine((v) => v.type !== 'waste' || Boolean(v.reason), {
    message: 'Indica el motivo de la merma',
    path: ['reason'],
  });

export const staffRoleSchema = z.enum(['admin', 'cashier', 'waiter', 'kitchen', 'bar', 'ai_agent']);

export const createStaffSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(10, 'Mínimo 10 caracteres').max(72),
  full_name: z.string().trim().min(2).max(120),
  role: staffRoleSchema,
});

export const onboardingSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  business_name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/, 'Sólo minúsculas, números y guiones (3-48)'),
});

export const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(6).max(72),
});

export const signUpSchema = loginSchema.extend({ password: z.string().min(10).max(72) });
