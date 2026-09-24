import 'server-only';

/**
 * Envío por Resend (https://resend.com) con su API REST, sin SDK.
 * Plan gratis: 3.000 correos/mes y 100/día. Mientras no verifiques un dominio,
 * el remitente es onboarding@resend.dev y sólo se puede enviar al correo dueño
 * de la cuenta de Resend.
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function emailFrom(): string {
  return process.env.RESEND_FROM || 'GastroBar <onboarding@resend.dev>';
}

export async function sendEmail(input: { to: string[]; subject: string; html: string; text: string }): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('El correo no está configurado en el servidor (RESEND_API_KEY).');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: emailFrom(), to: input.to, subject: input.subject, html: input.html, text: input.text }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok || !body.id) {
    const hint =
      res.status === 403 && emailFrom().includes('resend.dev')
        ? ' Con el remitente de prueba de Resend sólo puedes enviar al correo con el que creaste la cuenta; verifica un dominio en Resend para enviar a cualquiera.'
        : '';
    throw new Error(`Resend rechazó el envío (${res.status}): ${body.message ?? body.name ?? 'error desconocido'}.${hint}`);
  }
  return { id: body.id };
}
