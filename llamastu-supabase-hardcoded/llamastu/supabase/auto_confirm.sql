-- Auto-confirm any newly created users so they can immediately sign in on any device
CREATE OR REPLACE FUNCTION public.auto_confirm_new_users()
RETURNS trigger AS $$
BEGIN
  NEW.email_confirmed_at = coalesce(NEW.email_confirmed_at, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_new_users();

-- Also confirm any existing unconfirmed users
UPDATE auth.users 
SET email_confirmed_at = coalesce(email_confirmed_at, now())
WHERE email_confirmed_at IS NULL;
