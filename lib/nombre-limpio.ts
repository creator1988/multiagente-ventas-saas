// Prefijos que aparecen al inicio de filas de catálogo:
// "F164 LLEVA:", "E73 LLEVA:", "PROMO 49 INCLUYE:", "COMBO:", etc.
const REGEX_PREFIJO =
  /^([A-Z0-9]+\s+(LLEVA|INCLUYE)\s*:?\s*|PROMO\s+\d+\s+(LLEVA|INCLUYE|X\s+LLEVA|X\s+INCLUYE)\s*:?\s*|COMBO\s*:?\s*|INCLUYE\s*:?\s*)/i;

export function quitarPrefijo(texto: string): string {
  return texto
    .replace(REGEX_PREFIJO, '')
    .replace(/^\d+\s+/, '') // quita cantidad inicial: "7 CREMA..." → "CREMA..."
    .trim();
}

export function toTitulo(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase()) // title case
    .replace(/\bX(\d)/g, 'x$1');              // x60, x100ml — x en minúscula antes de número
}

function truncar(texto: string, max = 50): string {
  if (texto.length <= max) return texto;
  const cortado = texto.slice(0, max);
  const ultimo = cortado.lastIndexOf(' ');
  return ultimo > Math.floor(max / 2) ? cortado.slice(0, ultimo) : cortado;
}

// Para productos simples: quita prefijo, title case, trunca a 50 chars
export function limpiarNombreProducto(nombreOriginal: string): string {
  const sinPrefijo = quitarPrefijo(nombreOriginal);
  return truncar(toTitulo(sinPrefijo || nombreOriginal));
}

// Para cada parte de un combo: quita cantidad inicial, title case, trunca a 30 chars
export function limpiarParteCombo(parte: string): string {
  const sinQty = parte.replace(/^\d+\s+/, '').trim();
  return truncar(toTitulo(sinQty), 30);
}
