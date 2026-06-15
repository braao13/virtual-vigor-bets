
-- ============================================================
-- SETTLEMENT SYSTEM
-- ============================================================

-- 1. Add corner / card columns to matches
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS home_corners INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS away_corners INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS home_cards   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS away_cards   INTEGER NOT NULL DEFAULT 0;

-- 2. Win-streak columns on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS current_win_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS best_win_streak    INTEGER NOT NULL DEFAULT 0;

-- 3. Extend market_type enum
ALTER TYPE public.market_type ADD VALUE IF NOT EXISTS 'corners_over_under';
ALTER TYPE public.market_type ADD VALUE IF NOT EXISTS 'cards_over_under';

-- 4. Notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON public.notifications(user_id, created_at DESC);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- HELPER: resolve a single bet item's outcome
-- Returns 'won' | 'lost' | 'void'
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_item_status(
  p_market_type  TEXT,
  p_selection    TEXT,
  p_line         NUMERIC,
  p_home_score   INTEGER,
  p_away_score   INTEGER,
  p_home_corners INTEGER,
  p_away_corners INTEGER,
  p_home_cards   INTEGER,
  p_away_cards   INTEGER
) RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_total INTEGER;
BEGIN
  CASE p_market_type
    WHEN 'match_winner' THEN
      RETURN CASE p_selection
        WHEN 'home' THEN CASE WHEN p_home_score > p_away_score  THEN 'won' ELSE 'lost' END
        WHEN 'draw' THEN CASE WHEN p_home_score = p_away_score  THEN 'won' ELSE 'lost' END
        WHEN 'away' THEN CASE WHEN p_away_score > p_home_score  THEN 'won' ELSE 'lost' END
        ELSE 'void'
      END;

    WHEN 'double_chance' THEN
      RETURN CASE p_selection
        WHEN '1X' THEN CASE WHEN p_home_score >= p_away_score           THEN 'won' ELSE 'lost' END
        WHEN 'X2' THEN CASE WHEN p_away_score >= p_home_score           THEN 'won' ELSE 'lost' END
        WHEN '12' THEN CASE WHEN p_home_score <> p_away_score           THEN 'won' ELSE 'lost' END
        ELSE 'void'
      END;

    WHEN 'both_teams_score' THEN
      RETURN CASE p_selection
        WHEN 'yes' THEN CASE WHEN p_home_score > 0 AND p_away_score > 0 THEN 'won' ELSE 'lost' END
        WHEN 'no'  THEN CASE WHEN p_home_score = 0 OR  p_away_score = 0 THEN 'won' ELSE 'lost' END
        ELSE 'void'
      END;

    WHEN 'goals_over_under' THEN
      v_total := p_home_score + p_away_score;
      IF p_line IS NOT NULL AND v_total = p_line::INTEGER THEN RETURN 'void'; END IF;
      RETURN CASE p_selection
        WHEN 'over'  THEN CASE WHEN v_total > COALESCE(p_line::INTEGER, 0)   THEN 'won' ELSE 'lost' END
        WHEN 'under' THEN CASE WHEN v_total < COALESCE(p_line::INTEGER, 999) THEN 'won' ELSE 'lost' END
        ELSE 'void'
      END;

    WHEN 'corners_over_under' THEN
      v_total := p_home_corners + p_away_corners;
      IF p_line IS NOT NULL AND v_total = p_line::INTEGER THEN RETURN 'void'; END IF;
      RETURN CASE p_selection
        WHEN 'over'  THEN CASE WHEN v_total > COALESCE(p_line::INTEGER, 0)   THEN 'won' ELSE 'lost' END
        WHEN 'under' THEN CASE WHEN v_total < COALESCE(p_line::INTEGER, 999) THEN 'won' ELSE 'lost' END
        ELSE 'void'
      END;

    WHEN 'cards_over_under' THEN
      v_total := p_home_cards + p_away_cards;
      IF p_line IS NOT NULL AND v_total = p_line::INTEGER THEN RETURN 'void'; END IF;
      RETURN CASE p_selection
        WHEN 'over'  THEN CASE WHEN v_total > COALESCE(p_line::INTEGER, 0)   THEN 'won' ELSE 'lost' END
        WHEN 'under' THEN CASE WHEN v_total < COALESCE(p_line::INTEGER, 999) THEN 'won' ELSE 'lost' END
        ELSE 'void'
      END;

    ELSE
      RETURN 'void';
  END CASE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_item_status(TEXT,TEXT,NUMERIC,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER)
  TO authenticated, service_role;

-- ============================================================
-- CORE: settle all pending bets whose matches are finished
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_pending_bets()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bet            RECORD;
  v_item_row       RECORD;
  v_pending_count  INTEGER;
  v_lost_count     INTEGER;
  v_won_count      INTEGER;
  v_void_count     INTEGER;
  v_effective_odds NUMERIC;
  v_actual_return  NUMERIC;
  v_final_status   public.bet_status;
  v_user_balance   NUMERIC;
  v_notif_title    TEXT;
  v_notif_msg      TEXT;
  v_settled        INTEGER := 0;
  v_won_bets       INTEGER := 0;
  v_lost_bets      INTEGER := 0;
  v_void_bets      INTEGER := 0;
BEGIN
  FOR v_bet IN
    SELECT * FROM public.bets WHERE status = 'pending'
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Settle pending items for finished matches
    UPDATE public.bet_items bi
    SET
      status = public.resolve_item_status(
                 bi.market_type::TEXT, bi.selection, bi.line,
                 m.home_score, m.away_score,
                 m.home_corners, m.away_corners,
                 m.home_cards, m.away_cards
               )::public.bet_status,
      settled_at = NOW()
    FROM public.matches m
    WHERE bi.match_id = m.id
      AND bi.bet_id = v_bet.id
      AND bi.status = 'pending'
      AND m.status = 'finished';

    -- Skip bet if any items still pending (unfinished matches)
    SELECT COUNT(*) INTO v_pending_count
    FROM public.bet_items WHERE bet_id = v_bet.id AND status = 'pending';
    IF v_pending_count > 0 THEN CONTINUE; END IF;

    -- Aggregate item outcomes
    SELECT
      COUNT(*) FILTER (WHERE status = 'lost'),
      COUNT(*) FILTER (WHERE status = 'won'),
      COUNT(*) FILTER (WHERE status = 'void')
    INTO v_lost_count, v_won_count, v_void_count
    FROM public.bet_items WHERE bet_id = v_bet.id;

    -- Compute effective accumulator odds (won items only; void items excluded)
    v_effective_odds := 1;
    FOR v_item_row IN
      SELECT odds_at_placement FROM public.bet_items
      WHERE bet_id = v_bet.id AND status = 'won'
    LOOP
      v_effective_odds := v_effective_odds * v_item_row.odds_at_placement;
    END LOOP;

    -- Determine final bet status and return
    IF v_lost_count > 0 THEN
      v_final_status  := 'lost';
      v_actual_return := 0;
    ELSIF v_won_count = 0 THEN
      -- All items void → full refund
      v_final_status  := 'void';
      v_actual_return := v_bet.stake;
    ELSE
      v_final_status  := 'won';
      v_actual_return := ROUND(v_bet.stake * v_effective_odds, 2);
    END IF;

    -- Mark bet settled (idempotency: status check already prevents double-credit)
    UPDATE public.bets
    SET status = v_final_status, actual_return = v_actual_return, settled_at = NOW()
    WHERE id = v_bet.id;

    -- Credit balance on win or void
    IF v_final_status IN ('won', 'void') THEN
      SELECT balance INTO v_user_balance
      FROM public.profiles WHERE id = v_bet.user_id FOR UPDATE;

      UPDATE public.profiles
      SET balance = balance + v_actual_return
      WHERE id = v_bet.user_id;

      INSERT INTO public.wallet_transactions
        (user_id, type, amount, balance_before, balance_after, description, bet_id)
      VALUES (
        v_bet.user_id,
        CASE v_final_status
          WHEN 'won'  THEN 'bet_won'::public.transaction_type
          ELSE             'bet_void'::public.transaction_type
        END,
        v_actual_return,
        v_user_balance,
        v_user_balance + v_actual_return,
        CASE v_final_status
          WHEN 'won'  THEN 'Aposta ganha'
          ELSE             'Aposta estornada (anulada)'
        END,
        v_bet.id
      );
    END IF;

    -- Update profile stats
    IF v_final_status = 'won' THEN
      UPDATE public.profiles
      SET
        total_won          = total_won + 1,
        total_profit       = total_profit + (v_actual_return - v_bet.stake),
        current_win_streak = current_win_streak + 1,
        best_win_streak    = GREATEST(best_win_streak, current_win_streak + 1)
      WHERE id = v_bet.user_id;
    ELSIF v_final_status = 'lost' THEN
      UPDATE public.profiles
      SET current_win_streak = 0
      WHERE id = v_bet.user_id;
    END IF;

    -- Create user notification
    v_notif_title := CASE v_final_status
      WHEN 'won'  THEN '🏆 Aposta Ganha!'
      WHEN 'lost' THEN '❌ Aposta Perdida'
      ELSE             '↩️ Aposta Anulada'
    END;
    v_notif_msg := CASE v_final_status
      WHEN 'won'  THEN format('Sua aposta de R$ %s retornou R$ %s',
                       to_char(v_bet.stake, 'FM999990.00'),
                       to_char(v_actual_return, 'FM999990.00'))
      WHEN 'lost' THEN format('Sua aposta de R$ %s não foi desta vez',
                       to_char(v_bet.stake, 'FM999990.00'))
      ELSE             format('Sua aposta foi estornada: R$ %s devolvidos',
                       to_char(v_actual_return, 'FM999990.00'))
    END;

    INSERT INTO public.notifications (user_id, title, message)
    VALUES (v_bet.user_id, v_notif_title, v_notif_msg);

    v_settled := v_settled + 1;
    CASE v_final_status
      WHEN 'won'  THEN v_won_bets  := v_won_bets  + 1;
      WHEN 'lost' THEN v_lost_bets := v_lost_bets + 1;
      ELSE             v_void_bets := v_void_bets + 1;
    END CASE;
  END LOOP;

  RETURN jsonb_build_object(
    'settled', v_settled,
    'won',     v_won_bets,
    'lost',    v_lost_bets,
    'void',    v_void_bets
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.settle_pending_bets() TO authenticated, service_role;

-- ============================================================
-- simulate_match_result: set scores + trigger settlement
-- ============================================================
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
BEGIN
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

-- ============================================================
-- pg_cron (optional — enable in Supabase dashboard → Extensions)
-- After enabling, run once:
--   SELECT cron.schedule(
--     'settle-bets-hourly',
--     '0 * * * *',
--     $$SELECT public.settle_pending_bets()$$
--   );
-- ============================================================
