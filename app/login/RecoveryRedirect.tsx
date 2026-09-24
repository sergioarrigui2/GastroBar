'use client';

import { useEffect } from 'react';

/**
 * Los enlaces de recuperación con flujo implícito caen en la Site URL con
 * `#...type=recovery` y el proxy los trae aquí conservando el hash: los
 * reenviamos a la pantalla de nueva contraseña.
 */
export function RecoveryRedirect() {
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get('type') === 'recovery' && hash.get('access_token')) {
      window.location.replace(`/auth/reset${window.location.hash}`);
    } else if (hash.get('error_code')) {
      // Enlace vencido o ya usado (confirmación o recuperación): mostrar la ayuda del login.
      window.location.replace('/login?error=confirm');
    }
  }, []);
  return null;
}
