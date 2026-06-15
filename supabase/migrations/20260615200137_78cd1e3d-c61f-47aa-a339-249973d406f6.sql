
-- ENUMS
CREATE TYPE public.bet_status AS ENUM ('pending', 'won', 'lost', 'cancelled', 'void');
CREATE TYPE public.transaction_type AS ENUM ('initial_deposit', 'bet_placed', 'bet_won', 'bet_void', 'balance_reset');
CREATE TYPE public.market_type AS ENUM (
  'match_winner', 'double_chance', 'both_teams_score', 'goals_over_under'
);

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  avatar_url TEXT,
  balance NUMERIC(12,2) NOT NULL DEFAULT 1000.00,
  total_bets INTEGER NOT NULL DEFAULT 0,
  total_won INTEGER NOT NULL DEFAULT 0,
  total_profit NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- MATCHES
CREATE TABLE public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  league_name TEXT NOT NULL,
  league_country TEXT,
  match_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  home_score INTEGER,
  away_score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_matches_date ON public.matches(match_date);
CREATE INDEX idx_matches_status ON public.matches(status);
GRANT SELECT ON public.matches TO authenticated;
GRANT ALL ON public.matches TO service_role;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "matches_select_all" ON public.matches FOR SELECT TO authenticated USING (true);

-- ODDS
CREATE TABLE public.odds_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  market_type public.market_type NOT NULL,
  selection TEXT NOT NULL,
  selection_label TEXT NOT NULL,
  odds_value NUMERIC(8,3) NOT NULL,
  line NUMERIC(6,2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_odds_match ON public.odds_cache(match_id);
GRANT SELECT ON public.odds_cache TO authenticated;
GRANT ALL ON public.odds_cache TO service_role;
ALTER TABLE public.odds_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "odds_select_all" ON public.odds_cache FOR SELECT TO authenticated USING (true);

-- BETS
CREATE TABLE public.bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bet_type TEXT NOT NULL DEFAULT 'single',
  stake NUMERIC(12,2) NOT NULL CHECK (stake > 0),
  total_odds NUMERIC(10,3) NOT NULL CHECK (total_odds >= 1.01),
  potential_return NUMERIC(12,2) NOT NULL,
  actual_return NUMERIC(12,2),
  status public.bet_status NOT NULL DEFAULT 'pending',
  selections_count INTEGER NOT NULL DEFAULT 1,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bets_user ON public.bets(user_id);
CREATE INDEX idx_bets_status ON public.bets(status);
GRANT SELECT ON public.bets TO authenticated;
GRANT ALL ON public.bets TO service_role;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bets_select_own" ON public.bets FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- BET ITEMS
CREATE TABLE public.bet_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id UUID NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id),
  market_type public.market_type NOT NULL,
  selection TEXT NOT NULL,
  selection_label TEXT NOT NULL,
  odds_at_placement NUMERIC(8,3) NOT NULL,
  line NUMERIC(6,2),
  status public.bet_status NOT NULL DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bet_items_bet ON public.bet_items(bet_id);
CREATE INDEX idx_bet_items_match ON public.bet_items(match_id);
GRANT SELECT ON public.bet_items TO authenticated;
GRANT ALL ON public.bet_items TO service_role;
ALTER TABLE public.bet_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bet_items_select_own" ON public.bet_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bets WHERE bets.id = bet_id AND bets.user_id = auth.uid()));

-- WALLET TRANSACTIONS
CREATE TABLE public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type public.transaction_type NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  balance_before NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  description TEXT NOT NULL,
  bet_id UUID REFERENCES public.bets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tx_user ON public.wallet_transactions(user_id, created_at DESC);
GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT ALL ON public.wallet_transactions TO service_role;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tx_select_own" ON public.wallet_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_matches_updated BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_bets_updated BEFORE UPDATE ON public.bets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- New user trigger: profile + welcome bonus
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_username TEXT;
BEGIN
  v_username := COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1));
  -- ensure uniqueness
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = v_username) LOOP
    v_username := v_username || floor(random()*10000)::text;
  END LOOP;

  INSERT INTO public.profiles (id, email, username, balance)
  VALUES (NEW.id, NEW.email, v_username, 1000.00);

  INSERT INTO public.wallet_transactions (user_id, type, amount, balance_before, balance_after, description)
  VALUES (NEW.id, 'initial_deposit', 1000.00, 0, 1000.00, 'Bônus de boas-vindas — saldo inicial');

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- PLACE BET RPC (atomic)
CREATE OR REPLACE FUNCTION public.place_bet(
  p_idempotency_key TEXT,
  p_stake NUMERIC,
  p_selections JSONB  -- array of {odds_id, match_id, market_type, selection, selection_label, odds_value, line}
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_balance NUMERIC;
  v_total_odds NUMERIC := 1;
  v_potential NUMERIC;
  v_bet_id UUID;
  v_existing UUID;
  v_sel JSONB;
  v_count INT;
  v_match_date TIMESTAMPTZ;
  v_odds NUMERIC;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- idempotency
  SELECT id INTO v_existing FROM public.bets WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF p_stake < 1 THEN RAISE EXCEPTION 'Valor mínimo da aposta é R$ 1,00'; END IF;

  v_count := jsonb_array_length(p_selections);
  IF v_count < 1 OR v_count > 30 THEN
    RAISE EXCEPTION 'Número inválido de seleções';
  END IF;

  -- Lock balance
  SELECT balance INTO v_balance FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF v_balance < p_stake THEN
    RAISE EXCEPTION 'Saldo insuficiente';
  END IF;

  -- Validate each selection and compute total odds
  FOR v_sel IN SELECT * FROM jsonb_array_elements(p_selections) LOOP
    SELECT match_date INTO v_match_date FROM public.matches WHERE id = (v_sel->>'match_id')::uuid;
    IF v_match_date IS NULL OR v_match_date <= NOW() THEN
      RAISE EXCEPTION 'Partida já iniciou ou não existe';
    END IF;
    v_odds := (v_sel->>'odds_value')::numeric;
    IF v_odds < 1.01 THEN RAISE EXCEPTION 'Odd inválida'; END IF;
    v_total_odds := v_total_odds * v_odds;
  END LOOP;

  v_potential := ROUND(p_stake * v_total_odds, 2);

  -- Insert bet
  INSERT INTO public.bets (idempotency_key, user_id, bet_type, stake, total_odds, potential_return, selections_count)
  VALUES (p_idempotency_key, v_user, CASE WHEN v_count = 1 THEN 'single' ELSE 'multiple' END,
          p_stake, ROUND(v_total_odds, 3), v_potential, v_count)
  RETURNING id INTO v_bet_id;

  -- Insert items
  INSERT INTO public.bet_items (bet_id, match_id, market_type, selection, selection_label, odds_at_placement, line)
  SELECT v_bet_id,
         (s->>'match_id')::uuid,
         (s->>'market_type')::public.market_type,
         s->>'selection',
         s->>'selection_label',
         (s->>'odds_value')::numeric,
         NULLIF(s->>'line','')::numeric
  FROM jsonb_array_elements(p_selections) s;

  -- Debit
  UPDATE public.profiles
    SET balance = balance - p_stake,
        total_bets = total_bets + 1
    WHERE id = v_user;

  INSERT INTO public.wallet_transactions (user_id, type, amount, balance_before, balance_after, description, bet_id)
  VALUES (v_user, 'bet_placed', -p_stake, v_balance, v_balance - p_stake,
          'Aposta realizada', v_bet_id);

  RETURN v_bet_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_bet(TEXT, NUMERIC, JSONB) TO authenticated;
