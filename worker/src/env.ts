/** Configuracion del Worker (wrangler.toml vars + secrets). */

export interface Env {
  /** URL del proyecto Supabase, ej. https://xxxx.supabase.co */
  SUPABASE_URL: string;
  /**
   * Clave de servicio. NUNCA es una NEXT_PUBLIC_*: vive como secret del Worker
   * (`wrangler secret put SUPABASE_SERVICE_ROLE_KEY`). El navegador solo tiene la
   * clave publica y permisos de lectura para Realtime.
   */
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Token compartido con la vista Host para las acciones privilegiadas. */
  HOST_TOKEN?: string;
  /**
   * Contraseña que se teclea en el arranque de la consola del Host (pantalla grande).
   * Si no se configura vale `9806` (guardia de aula, no un secreto fuerte: cualquiera
   * que vea el proyector la conoce, pero evita que un equipo abra los controles).
   */
  HOST_PASSCODE?: string;
  /** Solo para desarrollo local: permite acciones de host sin token. */
  ALLOW_INSECURE_HOST?: string;
  /** Origenes permitidos separados por coma. Por defecto "*". */
  ALLOWED_ORIGINS?: string;
}

export interface WorkerConfig {
  supabaseUrl: string;
  supabaseKey: string;
  hostToken: string | null;
  hostPasscode: string;
  allowInsecureHost: boolean;
  allowedOrigins: string[];
}

/**
 * Contraseña por defecto del Host cuando el Worker no define HOST_PASSCODE.
 * Está a la vista a propósito: es un guardia de aula, no autenticación real.
 */
export const DEFAULT_HOST_PASSCODE = '9806';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function readConfig(env: Env): WorkerConfig {
  const supabaseUrl = (env.SUPABASE_URL ?? '').trim();
  const supabaseKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!supabaseUrl) throw new ConfigError('Falta SUPABASE_URL en la configuracion del Worker');
  if (!supabaseKey) {
    throw new ConfigError(
      'Falta SUPABASE_SERVICE_ROLE_KEY. Configurala con `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (el Worker es el unico que escribe).',
    );
  }
  const hostToken = (env.HOST_TOKEN ?? '').trim();
  const hostPasscode = (env.HOST_PASSCODE ?? '').trim() || DEFAULT_HOST_PASSCODE;
  return {
    supabaseUrl,
    supabaseKey,
    hostToken: hostToken.length > 0 ? hostToken : null,
    hostPasscode,
    allowInsecureHost: (env.ALLOW_INSECURE_HOST ?? '').toLowerCase() === 'true',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '*')
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
  };
}
