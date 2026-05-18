import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export const SUPABASE_URL = 'https://bjfbmjhltddtbcqkvkha.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_GNWC6k5sB0ohTC5quOKV4w_I7IsfQq0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
