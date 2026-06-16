
-- Trigger-only functions: nobody should call them directly
REVOKE ALL ON FUNCTION public.prevent_self_admin_escalation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- place_bet: only authenticated users may call it
REVOKE ALL ON FUNCTION public.place_bet(text, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_bet(text, numeric, jsonb) TO authenticated;
