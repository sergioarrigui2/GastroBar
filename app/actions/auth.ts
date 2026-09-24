'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loginSchema, signUpSchema } from '@/lib/validations/admin';

export type AuthFormState = { error?: string; info?: string } | null;

const str = (formData: FormData, key: string) => String(formData.get(key) ?? '');

/** Evita open redirects: sólo rutas internas. */
function safeNext(value: string): string {
  return value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({ email: str(formData, 'email'), password: str(formData, 'password') });
  if (!parsed.success) return { error: 'Correo o contraseña inválidos' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: 'Credenciales incorrectas' };

  redirect(safeNext(str(formData, 'next')));
}

/** Envía el correo de recuperación. Responde igual exista o no la cuenta (no filtra correos). */
export async function requestPasswordResetAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = z.email().safeParse(str(formData, 'email').trim());
  if (!email.success) return { error: 'Correo inválido' };

  const supabase = await createSupabaseServerClient();
  const origin = (await headers()).get('origin') ?? '';
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${origin}/auth/callback?next=/auth/reset`,
  });
  if (error?.status === 429) return { error: 'Demasiados intentos. Espera unos minutos y vuelve a intentar.' };

  return { info: 'Si ese correo tiene cuenta, te enviamos un enlace para crear una nueva contraseña. Ábrelo en este mismo navegador.' };
}

/** Fija la nueva contraseña del usuario con sesión de recuperación activa. */
export async function updatePasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const password = str(formData, 'password');
  if (password !== str(formData, 'confirm')) return { error: 'Las contraseñas no coinciden' };
  const parsed = signUpSchema.shape.password.safeParse(password);
  if (!parsed.success) return { error: 'La contraseña debe tener entre 10 y 72 caracteres' };

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: 'El enlace expiró. Solicita uno nuevo desde "¿Olvidaste tu contraseña?".' };

  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) {
    return { error: error.code === 'same_password' ? 'La nueva contraseña debe ser distinta a la anterior' : error.message };
  }

  redirect('/');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
