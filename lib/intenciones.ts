import type { Intencion } from '@/types';

const PATRONES: Record<Intencion, RegExp[]> = {
  saludo: [
    /^(hola|buenos\s*(días|tardes|noches)|buenas|hey|hi|saludos|qué\s*más|quiubo)/i,
    /^(buen\s*día|good\s*morning|buen\s*día)/i,
  ],
  catalogo: [
    /(catálogo|catalogo|productos?|qué\s*tienen|qué\s*hay|lista\s*de|precios?)/i,
    /(qué\s*venden|que\s*venden|disponib|inventario)/i,
  ],
  historial: [
    /(historial|últimos?\s*pedidos?|mis\s*compras|qué\s*pedí|que\s*pedi|pedidos?\s*anteriores)/i,
    /(última\s*vez|compré|lo\s*que\s*pedí)/i,
  ],
  pedido: [
    /(quiero|necesito|me\s*das?|pide|ordenar|comprar|llevar|despachar)/i,
    /(\d+\s*(unidades?|cajas?|bultos?|paquetes?|und|caj))/i,
    /(hacer\s*un\s*pedido|realizar\s*un\s*pedido|nuevo\s*pedido)/i,
  ],
  ver_ofertas: [
    /(ofert|promo|combo|descuento)/i,
    /(mejor\s*precio|precio\s*especial|especiales)/i,
  ],
  repetir_pedido: [
    /\b(repetir|lo\s*mismo|de\s*siempre|igual\s*que\s*(la\s*)?[uú]ltima\s*vez|mismo\s*pedido)\b/i,
  ],
  categoria_seleccionada: [], // detectado por ID 'cat_' antes del loop
  agregar_pedido: [],         // detectado por btn_agregar antes del loop
  confirmar_pedido: [
    /\b(confirmo|confirmar|s[ií]\s*confirmo|listo|de\s*acuerdo|dale|va\b|ok\b)\b/i,
  ],
  consulta_stock: [
    /(hay|tienen|stock|disponible|existe|cuánto\s*hay|cuantos\s*hay)/i,
    /(inventario\s*de|stock\s*de|quedan)/i,
  ],
  consulta_pedido: [
    /(estado\s*(del|de\s*mi)\s*pedido|cómo\s*va\s*mi\s*pedido|mi\s*pedido)/i,
    /(rastrear|seguimiento|dónde\s*está\s*mi)/i,
  ],
  audio: [],
  desconocido: [],
};

const SKIP_EN_LOOP: Intencion[] = [
  'audio', 'desconocido', 'categoria_seleccionada', 'agregar_pedido',
];

export function clasificarIntencion(texto: string): Intencion {
  // IDs de botones/listas — tienen prioridad absoluta sobre regex
  if (texto.startsWith('cat_'))                        return 'categoria_seleccionada';
  if (texto.startsWith('add_'))                        return 'agregar_pedido';
  if (texto === 'btn_agregar' ||
      texto === 'btn_agregar_mas')                     return 'agregar_pedido';
  if (texto === 'btn_confirmar' ||
      texto === 'btn_confirmar_igual')                 return 'confirmar_pedido';
  if (texto === 'btn_ofertas')                         return 'ver_ofertas';
  if (texto === 'btn_ver_cat' ||
      texto === 'btn_modificar')                       return 'catalogo';

  for (const [intencion, patrones] of Object.entries(PATRONES) as [Intencion, RegExp[]][]) {
    if (SKIP_EN_LOOP.includes(intencion)) continue;
    for (const patron of patrones) {
      if (patron.test(texto)) return intencion;
    }
  }
  return 'desconocido';
}
