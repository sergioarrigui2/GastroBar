// Copia de seguridad manual de TODOS los datos del negocio (modo piloto, sin plan de pago de Supabase).
//   npm run backup
// Guarda una carpeta backups/AAAA-MM-DD_HHMM con un archivo JSON por tabla, más manifest.json con los conteos.
// Usa el rol de servicio de .env.local. La carpeta backups/ no se sube al repositorio: guárdala en un lugar seguro.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. Ejecuta: npm run backup');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });
const PAGE = 1000;

// La lista de tablas sale de la propia API (esquema public), para no olvidar ninguna tabla nueva.
const spec = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then((r) => r.json());
const tables = Object.keys(spec.definitions ?? {}).sort();
if (!tables.length) {
  console.error('No pude leer la lista de tablas.');
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
const dir = join('backups', stamp);
mkdirSync(dir, { recursive: true });

const manifest = { created_at: new Date().toISOString(), tables: {}, errors: {} };
for (const table of tables) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1);
    if (error) {
      manifest.errors[table] = error.message;
      break;
    }
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  if (!manifest.errors[table]) {
    writeFileSync(join(dir, `${table}.json`), JSON.stringify(rows));
    manifest.tables[table] = rows.length;
  }
  console.log(`${table.padEnd(34)} ${manifest.errors[table] ? 'ERROR ' + manifest.errors[table] : rows.length}`);
}

// Usuarios (correo e id, sin contraseñas): para saber quién es quién al restaurar.
const users = [];
for (let page = 1; ; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) {
    manifest.errors['auth.users'] = error.message;
    break;
  }
  users.push(...data.users.map((u) => ({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at })));
  if (data.users.length < 1000) break;
}
writeFileSync(join(dir, 'auth_users.json'), JSON.stringify(users));
manifest.tables['auth.users'] = users.length;

writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const failed = Object.keys(manifest.errors).length;
console.log(`\nCopia guardada en ${dir} (${Object.keys(manifest.tables).length} tablas${failed ? `, ${failed} con error` : ''}).`);
process.exit(failed ? 1 : 0);
