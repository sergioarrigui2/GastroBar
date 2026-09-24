'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { toUserMessage } from '@/lib/errors';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loginSchema, onboardingSchema, signUpSchema } from '@/lib/validations/admin';

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

/**
 * Registro del dueño + alta del gastrobar. Si el usuario ya tiene sesión (p. ej.
 * confirmó su correo), sólo crea el tenant.
 */
export async function onboardingAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const business = onboardingSchema.safeParse({
    full_name: str(formData, 'full_name'),
    business_name: str(formData, 'business_name'),
    slug: str(formData, 'slug'),
  });
  if (!business.success) return { error: toUserMessage(business.error) };

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();

  if (!claims?.claims?.sub) {
    const credentials = signUpSchema.safeParse({ email: str(formData, 'email'), password: str(formData, 'password') });
    if (!credentials.success) return { error: 'Correo inválido o contraseña de menos de 10 caracteres' };

    // Si la cuenta ya existe (p. ej. se registró antes y confirmó el correo), inicia sesión con ella.
    const signIn = await supabase.auth.signInWithPassword(credentials.data);
    if (signIn.error) {
      if (signIn.error.code === 'email_not_confirmed') {
        return { info: 'Tu correo aún no está confirmado. Abre el enlace que te enviamos y vuelve a enviar este formulario.' };
      }
      const origin = (await headers()).get('origin') ?? '';
      const { data, error } = await supabase.auth.signUp({
        ...credentials.data,
        options: { emailRedirectTo: `${origin}/auth/callback?next=/onboarding` },
      });
      if (error) {
        return { error: error.code === 'user_already_exists' ? 'Ese correo ya está registrado con otra contraseña' : error.message };
      }
      if (!data.session) {
        return { info: 'Te enviamos un correo de confirmación. Ábrelo y volverás aquí para terminar de crear tu gastrobar.' };
      }
    }
  }

  const { error } = await supabase.rpc('create_tenant', {
    p_name: business.data.business_name,
    p_slug: business.data.slug,
    p_full_name: business.data.full_name,
  });
  if (error) {
    return { error: error.code === '23505' && !error.message.includes('already_member') ? 'Ese identificador ya está en uso' : toUserMessage(error) };
  }

  redirect('/admin/help');
}
