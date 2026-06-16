ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
UPDATE public.profiles SET is_admin = true WHERE email = 'abraaocoelho257@gmail.com';