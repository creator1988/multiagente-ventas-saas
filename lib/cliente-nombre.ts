const PLACEHOLDER = 'Cliente nuevo';

// Nombre real del cliente para mostrar en saludos, logs, emails o el contexto
// del LLM — nunca devuelve el placeholder de onboarding ('Cliente nuevo') que
// crearClienteTemporal usa en nombre_negocio/nombre_contacto antes de que el
// cliente dé sus datos reales. Devuelve null si no hay ningún nombre real aún.
export function nombreClienteVisible(
  cliente?: { nombre_negocio?: string | null; nombre_contacto?: string | null } | null
): string | null {
  const candidatos = [cliente?.nombre_negocio, cliente?.nombre_contacto];
  return candidatos.find((n) => n && n !== PLACEHOLDER) ?? null;
}
