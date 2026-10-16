'use client';

import { useState } from 'react';
import { updateMyProfileAction } from '@/app/actions/profile';
import { FlashMessage, useAdminMutation } from '@/components/admin/useAdminMutation';
import { PhotoUploader } from '@/components/ui/PhotoUploader';
import { Button, Card, Input, Label } from '@/components/ui/primitives';
import { AVATAR_BUCKET, avatarPhoto } from '@/lib/images/process';

export function ProfileForm({
  tenantId,
  userId,
  roleLabel,
  email,
  initial,
}: {
  tenantId: string;
  userId: string;
  roleLabel: string;
  email: string | null;
  initial: { full_name: string; phone: string | null; avatar_url: string | null };
}) {
  const { run, pending, flash } = useAdminMutation();
  const [fullName, setFullName] = useState(initial.full_name);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [avatar, setAvatar] = useState<string | null>(initial.avatar_url);

  const save = () => run(() => updateMyProfileAction({ full_name: fullName, phone: phone.trim() || null, avatar_url: avatar }), 'Datos guardados');

  return (
    <div className="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
      <h1 className="text-2xl font-bold">Mi perfil</h1>
      <Card className="space-y-4">
        <PhotoUploader
          bucket={AVATAR_BUCKET}
          folder={`${tenantId}/${userId}`}
          value={avatar}
          process={avatarPhoto}
          round
          hint="Tu foto ayuda a que tu equipo te reconozca. JPG, PNG o WebP; se recorta en cuadrado."
          onChange={setAvatar}
        />
        <div>
          <Label htmlFor="p-name">Nombre completo</Label>
          <Input id="p-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
        </div>
        <div>
          <Label htmlFor="p-phone">Teléfono</Label>
          <Input id="p-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="300 123 4567" />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-zinc-500">
          <dt>Cargo</dt>
          <dd className="font-medium text-zinc-700 dark:text-zinc-300">{roleLabel}</dd>
          {email && (
            <>
              <dt>Correo</dt>
              <dd className="break-all font-medium text-zinc-700 dark:text-zinc-300">{email}</dd>
            </>
          )}
        </dl>
        <p className="text-xs text-zinc-500">Tu cargo y tus permisos los define el administrador. Los cambios de nombre quedan en la auditoría.</p>
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={pending || fullName.trim().length < 2}>
            Guardar
          </Button>
        </div>
      </Card>
      <FlashMessage flash={flash} />
    </div>
  );
}
