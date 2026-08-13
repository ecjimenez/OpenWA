// Client service_role — mesma finalidade do padrão em ssshilencio/_shared.
// Bypassa RLS. Só chamado a partir de Edge Functions, nunca do browser.
import { createClient } from 'jsr:@supabase/supabase-js@2';

export function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}
