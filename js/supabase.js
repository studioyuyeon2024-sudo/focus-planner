import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export const SUPABASE_URL = 'https://vhhopdfyuihjncutuejg.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_w0Wdhv9jWcuzbrwmfNdodg_iyhFsesx';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
