/**
 * Cliente de Supabase para el navegador. SOLO se usa para Realtime (aviso de cambio);
 * los datos siempre se piden al Worker con GET /game/:id/state.
 *
 * La clave pública solo tiene permiso de lectura (RLS), así que el navegador no puede
 * modificar el estado de la partida ni por accidente.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let cached: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  if (typeof window === 'undefined' || !env.supabaseUrl || !env.supabaseKey) {
    cached = null;
    return cached;
  }
  cached = createClient(env.supabaseUrl, env.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return cached;
}
