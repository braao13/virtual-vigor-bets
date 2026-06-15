
-- ============================================================
-- MIGRATION: Leagues, Rankings, Profiles, Notifications, Admin
-- ============================================================

-- 1. Adicionar campos faltando em profiles (já adicionados em migrações
--    anteriores via IF NOT EXISTS — seguro repetir)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_win_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_win_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. Atualizar RLS de profiles — impede auto-promoção via is_admin
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;

-- SELECT: cada usuário só vê o próprio perfil
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

-- UPDATE: somente campos não-financeiros; is_admin não pode ser auto-definido
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND is_admin = false);

-- Restrição de colunas via GRANT (financeiais só via SECURITY DEFINER)
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (username, avatar_url) ON public.profiles TO authenticated;

-- 3. ENUMs
DO $$ BEGIN
  CREATE TYPE public.notification_type AS ENUM (
    'bet_settled_won', 'bet_settled_lost', 'bet_void',
    'league_invite', 'member_joined', 'balance_reset'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.invite_status AS ENUM ('pending', 'used', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.league_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Atualizar notifications (pode já existir sem type/metadata)
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type       public.notification_type,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  metadata   JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Adicionar colunas que podem estar faltando (migração anterior criou sem type/metadata)
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS type public.notification_type;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Recriar índices e políticas
DROP INDEX IF EXISTS idx_notifications_user;
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications(created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_own" ON public.notifications;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_own" ON public.notifications FOR ALL TO authenticated
  USING (auth.uid() = user_id);

-- 5. TABLE: leagues
CREATE TABLE IF NOT EXISTS public.leagues (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT,
  avatar_url   TEXT,
  invite_code  TEXT UNIQUE NOT NULL DEFAULT upper(substr(md5(random()::text), 1, 8)),
  owner_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  max_members  INTEGER NOT NULL DEFAULT 50,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leagues_owner  ON public.leagues(owner_id);
CREATE INDEX IF NOT EXISTS idx_leagues_invite ON public.leagues(invite_code);
GRANT SELECT, INSERT, UPDATE ON public.leagues TO authenticated;
GRANT ALL ON public.leagues TO service_role;
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leagues_member_read" ON public.leagues FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.league_members lm
    WHERE lm.league_id = id AND lm.user_id = auth.uid()
  ));
CREATE POLICY "leagues_insert_own" ON public.leagues FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "leagues_update_owner" ON public.leagues FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id);

-- 6. TABLE: league_members
CREATE TABLE IF NOT EXISTS public.league_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       public.league_role NOT NULL DEFAULT 'member',
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(league_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_league_members_league ON public.league_members(league_id);
CREATE INDEX IF NOT EXISTS idx_league_members_user   ON public.league_members(user_id);
GRANT SELECT, INSERT, DELETE ON public.league_members TO authenticated;
GRANT ALL ON public.league_members TO service_role;
ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lm_read_own_leagues" ON public.league_members FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.league_members lm2
    WHERE lm2.league_id = league_id AND lm2.user_id = auth.uid()
  ));
CREATE POLICY "lm_insert_self" ON public.league_members FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "lm_delete_self" ON public.league_members FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 7. TABLE: league_invites
CREATE TABLE IF NOT EXISTS public.league_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  invited_by  UUID NOT NULL REFERENCES public.profiles(id),
  email       TEXT,
  status      public.invite_status NOT NULL DEFAULT 'pending',
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE ON public.league_invites TO authenticated;
GRANT ALL ON public.league_invites TO service_role;
ALTER TABLE public.league_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invites_read_own" ON public.league_invites FOR SELECT TO authenticated
  USING (invited_by = auth.uid()
    OR email = (SELECT email FROM public.profiles WHERE id = auth.uid()));

-- 8. TABLE: balance_reset_requests
CREATE TABLE IF NOT EXISTS public.balance_reset_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  reviewed_by  UUID REFERENCES public.profiles(id),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE ON public.balance_reset_requests TO authenticated;
GRANT ALL ON public.balance_reset_requests TO service_role;
ALTER TABLE public.balance_reset_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reset_req_own" ON public.balance_reset_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id
    OR (SELECT is_admin FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "reset_req_insert_own" ON public.balance_reset_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "reset_req_admin_update" ON public.balance_reset_requests FOR UPDATE TO authenticated
  USING ((SELECT is_admin FROM public.profiles WHERE id = auth.uid()));

-- 9. MATERIALIZED VIEW: user_rankings
CREATE MATERIALIZED VIEW IF NOT EXISTS public.user_rankings AS
SELECT
  p.id, p.username, p.avatar_url, p.balance,
  p.total_bets, p.total_won, p.total_profit,
  p.current_win_streak, p.best_win_streak,
  CASE WHEN p.total_bets > 0
    THEN ROUND((p.total_won::NUMERIC / p.total_bets) * 100, 2)
    ELSE 0
  END AS win_rate,
  COALESCE(SUM(CASE WHEN b.status = 'won'
    AND b.settled_at >= date_trunc('week', NOW())
    THEN b.actual_return - b.stake ELSE 0 END), 0) AS weekly_profit,
  COUNT(b.id) FILTER (
    WHERE b.status = 'won' AND b.settled_at >= date_trunc('week', NOW())
  ) AS weekly_wins,
  COALESCE(SUM(CASE WHEN b.status = 'won'
    AND b.settled_at >= date_trunc('month', NOW())
    THEN b.actual_return - b.stake ELSE 0 END), 0) AS monthly_profit,
  COUNT(b.id) FILTER (
    WHERE b.status = 'won' AND b.settled_at >= date_trunc('month', NOW())
  ) AS monthly_wins,
  p.created_at
FROM public.profiles p
LEFT JOIN public.bets b ON b.user_id = p.id
GROUP BY p.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_rankings_id ON public.user_rankings(id);
GRANT SELECT ON public.user_rankings TO authenticated;

-- 10. refresh_user_rankings
CREATE OR REPLACE FUNCTION public.refresh_user_rankings()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.user_rankings;
END;
$$;
GRANT EXECUTE ON FUNCTION public.refresh_user_rankings() TO service_role;

-- 11. join_league
CREATE OR REPLACE FUNCTION public.join_league(p_invite_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_league public.leagues%ROWTYPE;
  v_member_count INTEGER;
  v_user UUID := auth.uid();
BEGIN
  SELECT * INTO v_league FROM public.leagues WHERE invite_code = p_invite_code AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Liga não encontrada ou inativa'; END IF;

  IF EXISTS (SELECT 1 FROM public.league_members WHERE league_id = v_league.id AND user_id = v_user) THEN
    RAISE EXCEPTION 'Você já é membro desta liga';
  END IF;

  SELECT COUNT(*) INTO v_member_count FROM public.league_members WHERE league_id = v_league.id;
  IF v_member_count >= v_league.max_members THEN RAISE EXCEPTION 'Liga lotada'; END IF;

  INSERT INTO public.league_members (league_id, user_id, role)
  VALUES (v_league.id, v_user, 'member');

  INSERT INTO public.notifications (user_id, type, title, message, metadata)
  VALUES (
    v_league.owner_id, 'member_joined',
    '👥 Novo membro na liga!',
    'Um novo apostador entrou em ' || v_league.name,
    jsonb_build_object('league_id', v_league.id, 'league_name', v_league.name)
  );

  RETURN jsonb_build_object('league_id', v_league.id, 'league_name', v_league.name);
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_league(TEXT) TO authenticated;

-- 12. create_league
CREATE OR REPLACE FUNCTION public.create_league(p_name TEXT, p_description TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_league_id UUID;
  v_invite_code TEXT;
  v_user UUID := auth.uid();
BEGIN
  v_invite_code := upper(substr(md5(random()::text || v_user::text || NOW()::text), 1, 8));

  INSERT INTO public.leagues (name, description, owner_id, invite_code)
  VALUES (p_name, p_description, v_user, v_invite_code)
  RETURNING id INTO v_league_id;

  INSERT INTO public.league_members (league_id, user_id, role)
  VALUES (v_league_id, v_user, 'owner');

  RETURN jsonb_build_object('league_id', v_league_id, 'invite_code', v_invite_code);
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_league(TEXT, TEXT) TO authenticated;

-- 13. request_balance_reset
CREATE OR REPLACE FUNCTION public.request_balance_reset(p_reason TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user UUID := auth.uid();
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.balance_reset_requests WHERE user_id = v_user AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Você já tem um pedido de reset pendente';
  END IF;
  INSERT INTO public.balance_reset_requests (user_id, reason) VALUES (v_user, p_reason);
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_balance_reset(TEXT) TO authenticated;

-- 14. approve_balance_reset (com guarda admin — chamável por authenticated)
CREATE OR REPLACE FUNCTION public.approve_balance_reset(p_request_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.balance_reset_requests%ROWTYPE;
  v_balance_before NUMERIC;
  v_is_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores';
  END IF;

  SELECT * INTO v_req FROM public.balance_reset_requests WHERE id = p_request_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado ou já processado'; END IF;

  SELECT balance INTO v_balance_before FROM public.profiles WHERE id = v_req.user_id;

  UPDATE public.profiles SET
    balance = 1000.00, total_bets = 0, total_won = 0, total_profit = 0,
    current_win_streak = 0, best_win_streak = 0, updated_at = NOW()
  WHERE id = v_req.user_id;

  INSERT INTO public.wallet_transactions (user_id, type, amount, balance_before, balance_after, description)
  VALUES (v_req.user_id, 'balance_reset', 1000.00, v_balance_before, 1000.00,
          'Reset de saldo aprovado pelo administrador');

  UPDATE public.balance_reset_requests
  SET status = 'approved', reviewed_at = NOW()
  WHERE id = p_request_id;

  INSERT INTO public.notifications (user_id, type, title, message)
  VALUES (v_req.user_id, 'balance_reset', '🔄 Saldo resetado',
          'Seu saldo foi resetado para R$ 1.000,00. Seu histórico de ranking foi zerado.');

  PERFORM public.refresh_user_rankings();
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_balance_reset(UUID) TO authenticated, service_role;

-- 15. Trigger updated_at em leagues
DROP TRIGGER IF EXISTS trg_leagues_updated ON public.leagues;
CREATE TRIGGER trg_leagues_updated
  BEFORE UPDATE ON public.leagues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
