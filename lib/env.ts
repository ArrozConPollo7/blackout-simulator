/**
 * Configuración pública del frontend (variables NEXT_PUBLIC_* inyectadas en build).
 *
 * NEXT_PUBLIC_API_URL       URL del Cloudflare Worker (la única fuente de verdad).
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 *                           solo para Realtime; son valores públicos por diseño.
 * NEXT_PUBLIC_HOST_TOKEN    token de las acciones de host (crisis y fases). Es un
 *                           guardia de aula, no un secreto fuerte: los jugadores no lo
 *                           tienen, pero viaja en el bundle del Host.
 */

function clean(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

export const env = {
  apiUrl: clean(process.env.NEXT_PUBLIC_API_URL),
  supabaseUrl: clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseKey: clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  hostToken: (process.env.NEXT_PUBLIC_HOST_TOKEN ?? '').trim(),
};

/** Variables que faltan, para avisar en pantalla en vez de fallar en silencio. */
export const missingConfig: string[] = [
  ...(env.apiUrl ? [] : ['NEXT_PUBLIC_API_URL']),
  ...(env.supabaseUrl && env.supabaseKey
    ? []
    : ['NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY']),
  ...(env.hostToken ? [] : ['NEXT_PUBLIC_HOST_TOKEN']),
];

export const isApiConfigured = env.apiUrl.length > 0;

/**
 * Los avisos de configuración son para quien monta el juego, no para el aula: se muestran
 * solo en desarrollo. En la partida real la pantalla no puede tener jerga técnica.
 */
export const isDevelopment = process.env.NODE_ENV !== 'production';
