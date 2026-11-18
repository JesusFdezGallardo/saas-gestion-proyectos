import { ApiError } from './api';

/** Spanish text for an API failure. Matches the stable English messages first, then the code. */
const BY_MESSAGE: [RegExp, string][] = [
  [/at least one admin/i, 'Una organización necesita al menos un administrador.'],
  [/already registered/i, 'Ya existe una cuenta con ese correo.'],
  [/another email/i, 'Esta invitación es para otro correo. Inicia sesión con el correo invitado.'],
  [/already used/i, 'Esta invitación ya se ha usado.'],
  [/expired/i, 'Esta invitación ha caducado. Pide una nueva.'],
  [/invalid email or password/i, 'Correo o contraseña incorrectos.'],
  [/at least one column/i, 'Un tablero necesita al menos una columna.'],
  [/choose where to move/i, 'La columna tiene tarjetas: elige a qué columna moverlas.'],
];

const BY_CODE: Record<string, string> = {
  unauthenticated: 'Tu sesión ha caducado. Vuelve a entrar.',
  forbidden: 'No tienes permiso para hacer esto.',
  demo_protected: 'Las cuentas de demostración no pueden hacer esto.',
  not_found: 'No se ha encontrado lo que buscas.',
  validation: 'Revisa los datos introducidos.',
  conflict: 'No se ha podido completar la acción por un conflicto.',
  rate_limited: 'Demasiados intentos. Espera un minuto y vuelve a probar.',
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    for (const [re, text] of BY_MESSAGE) if (re.test(err.message)) return text;
    return BY_CODE[err.code] ?? 'Ha ocurrido un error inesperado. Inténtalo de nuevo.';
  }
  return 'No se ha podido conectar con el servidor.';
}
