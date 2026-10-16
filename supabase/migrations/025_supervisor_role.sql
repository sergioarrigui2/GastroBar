-- ════════════════════════════════════════════════════════════════════════════════
-- 025 · Rol «supervisor» (paso 1 de 2)
--
-- Postgres no permite usar un valor de enum recién agregado en la misma transacción
-- que lo crea, por eso el valor va solo en este archivo. Córrelo primero y, cuando
-- termine, corre 026_supervisor_permissions.sql.
-- ════════════════════════════════════════════════════════════════════════════════

alter type public.app_role add value if not exists 'supervisor';
