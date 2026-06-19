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
    /(quiero|necesito|me\s*das?|pide|pedido|ordenar|comprar|llevar|despachar)/i,
    /(\d+\s*(unidades?|cajas?|bultos?|paquetes?|und|caj))/i,
    /(hacer\s*un\s*pedido|realizar\s*un\s*pedido|nuevo\s*pedido)/i,
  ],
  consulta_stock: [
    /(hay|tienen|stock|disponible|existe|cuánto\s*hay|cuantos\s*hay)/i,
    /(inventario\s*de|stock\s*de|quedan)/i,
  ],
  consulta_pedido: [
    /(estado\s*(del|de\s*mi)\s*pedido|cómo\s*va\s*mi\s*pedido|mi\s*pedido)/i,
    /(rastrear|seguimiento|dónde\s*está\s*mi)/i,
  ],
  audio: [], // se detecta por tipo de mensaje, no por texto
  desconocido: [],
};

export function clasificarIntencion(texto: string): Intencion {
  for (const [intencion, patrones] of Object.entries(PATRONES) as [Intencion, RegExp[]][]) {
    if (intencion === 'audio' || intencion === 'desconocido') continue;
    for (const patron of patrones) {
      if (patron.test(texto)) return intencion;
    }
  }
  return 'desconocido';
}
