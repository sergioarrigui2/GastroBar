-- ════════════════════════════════════════════════════════════════════════════════
-- 020 · Reconocimiento de fotos del menú con IA
--
-- La carga masiva de imágenes puede pedir a la IA que sugiera a qué producto
-- corresponde cada foto. Su consumo se registra en ai_usage como 'menu_images'
-- (mismo control de costos y topes que el resto de la IA).
-- ════════════════════════════════════════════════════════════════════════════════

alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in ('analyst_report', 'purchase_agent', 'analyst_chat', 'menu_images'));
