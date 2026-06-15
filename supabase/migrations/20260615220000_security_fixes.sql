
-- ============================================================
-- SECURITY FIXES
-- ============================================================

-- FIX 1 (Critical): profiles SELECT — restrict to own row only.
-- Previously "USING (true)" allowed all authenticated users to read
-- every user's email and balance.
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

-- FIX 2 (Critical): profiles UPDATE — restrict writable columns.
-- Column-level: authenticated users may only change username / avatar_url.
-- Financial fields (balance, total_bets, total_won, total_profit,
-- current_win_streak, best_win_streak) are updated exclusively by
-- SECURITY DEFINER RPCs (which run as the function owner and bypass
-- column-level grants imposed on the authenticated role).
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (username, avatar_url) ON public.profiles TO authenticated;

-- FIX 3 (Warning): add is_admin flag and guard simulate_match_result.
-- Any authenticated user could previously call this SECURITY DEFINER
-- function and fake match results.  We now gate it behind is_admin.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.simulate_match_result(
  p_match_id      UUID,
  p_home_score    INTEGER,
  p_away_score    INTEGER,
  p_home_corners  INTEGER DEFAULT 0,
  p_away_corners  INTEGER DEFAULT 0,
  p_home_cards    INTEGER DEFAULT 0,
  p_away_cards    INTEGER DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- Admin guard: auth.uid() is available in session context even inside
  -- SECURITY DEFINER functions (reads from request.jwt.claims).
  SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores podem simular resultados';
  END IF;

  UPDATE public.matches SET
    status       = 'finished',
    home_score   = p_home_score,
    away_score   = p_away_score,
    home_corners = p_home_corners,
    away_corners = p_away_corners,
    home_cards   = p_home_cards,
    away_cards   = p_away_cards
  WHERE id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partida não encontrada: %', p_match_id;
  END IF;

  RETURN public.settle_pending_bets();
END;
$$;
GRANT EXECUTE ON FUNCTION public.simulate_match_result(UUID,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER)
  TO authenticated, service_role;

-- To grant admin access to a user, run once in the Supabase SQL editor:
--   UPDATE public.profiles SET is_admin = true WHERE email = 'your@email.com';
