import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { sql } from '@/lib/db';
import type { ProductoImport, OfertaImport, ResultadoImport, ResultadoUndo } from '@/types';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

// neon sql returns a union type; cast rows to work with TypeScript
type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = (r: any): Row[] => r as Row[];

async function runMigrations(): Promise<void> {
  await sql`ALTER TABLE productos ADD COLUMN IF NOT EXISTS sku VARCHAR(100)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_productos_sku_empresa ON productos(empresa_id, sku)`;
  await sql`ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS precio_combo NUMERIC(12,2)`;
  await sql`ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(500)`;
  await sql`ALTER TABLE productos ADD COLUMN IF NOT EXISTS importacion_id UUID`;
  await sql`ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS importacion_id UUID`;
}

async function getOrCreateCategoria(empresa_id: string, nombre: string): Promise<string> {
  const result = rows(await sql`
    INSERT INTO categorias (empresa_id, nombre, activa)
    VALUES (${empresa_id}, ${nombre}, true)
    ON CONFLICT (empresa_id, nombre) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id
  `);
  return result[0].id as string;
}

async function uploadImagen(base64: string, tipo: string, slug: string): Promise<string> {
  const buffer = Buffer.from(base64, 'base64');
  const ext = tipo === 'jpeg' ? 'jpg' : tipo;
  const { url } = await put(`catalog/${slug}.${ext}`, buffer, {
    access: 'public',
    token: process.env.CATALOG_BLOB_READ_WRITE_TOKEN,
    allowOverwrite: true,
  });
  return url;
}

// ---------------------------------------------------------------------------
// POST /api/catalog/import — importar productos y ofertas
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as {
    empresa_id?: string;
    productos: ProductoImport[];
    ofertas: OfertaImport[];
  };

  const empresa_id = body.empresa_id ?? EMPRESA_ID;
  const importacion_id = crypto.randomUUID();

  const resultado: ResultadoImport = {
    importacion_id,
    productos_creados: 0,
    productos_actualizados: 0,
    ofertas_creadas: 0,
    imagenes_subidas: 0,
    errores: [],
  };

  try {
    await runMigrations();

    // --- Importar productos simples ---
    for (const prod of body.productos) {
      try {
        let imagen_url: string | null = null;
        if (prod.imagen_base64) {
          imagen_url = await uploadImagen(
            prod.imagen_base64,
            prod.imagen_tipo ?? 'png',
            `prod_${prod.sku.replace(/[^a-zA-Z0-9]/g, '_')}`
          );
          resultado.imagenes_subidas++;
        }

        const categoria_id = await getOrCreateCategoria(empresa_id, prod.categoria);
        const existing = rows(await sql`
          SELECT id FROM productos WHERE empresa_id = ${empresa_id} AND sku = ${prod.sku}
        `);

        if (existing.length > 0) {
          // Actualiza sin tocar importacion_id — no "poseemos" registros preexistentes
          await sql`
            UPDATE productos SET
              nombre = ${prod.nombre},
              descripcion = ${prod.nombre_original},
              precio_lista = ${prod.precio},
              stock_disponible = ${prod.stock},
              categoria_id = ${categoria_id},
              url_imagen = COALESCE(${imagen_url}, url_imagen),
              activo = true
            WHERE empresa_id = ${empresa_id} AND sku = ${prod.sku}
          `;
          resultado.productos_actualizados++;
        } else {
          await sql`
            INSERT INTO productos
              (empresa_id, categoria_id, sku, nombre, descripcion, precio_lista,
               stock_disponible, url_imagen, activo, unidad_medida, importacion_id)
            VALUES
              (${empresa_id}, ${categoria_id}, ${prod.sku}, ${prod.nombre}, ${prod.nombre_original},
               ${prod.precio}, ${prod.stock}, ${imagen_url}, true, 'UND', ${importacion_id})
          `;
          resultado.productos_creados++;
        }
      } catch (err) {
        resultado.errores.push(`Producto ${prod.sku}: ${String(err)}`);
      }
    }

    // --- Importar ofertas/combos ---
    for (const oferta of body.ofertas) {
      try {
        let imagen_url: string | null = null;
        if (oferta.imagen_base64) {
          imagen_url = await uploadImagen(
            oferta.imagen_base64,
            oferta.imagen_tipo ?? 'png',
            `oferta_${oferta.nombre.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}`
          );
          resultado.imagenes_subidas++;
        }

        const ofertaRows = rows(await sql`
          INSERT INTO ofertas
            (empresa_id, nombre, descripcion, precio_combo, imagen_url,
             descuento_porcentaje, fecha_inicio, fecha_fin, activa, importacion_id)
          VALUES
            (${empresa_id}, ${oferta.nombre}, ${oferta.nombre_original}, ${oferta.precio_combo},
             ${imagen_url}, 0, NOW(), NOW() + INTERVAL '1 year', true, ${importacion_id})
          RETURNING id
        `);
        const oferta_id = ofertaRows[0].id as string;

        for (const frag of oferta.fragmentos) {
          const nombreBuscar = frag.nombre_producto.trim();
          let producto_id: string | null = null;

          const byNombre = rows(await sql`
            SELECT id FROM productos
            WHERE empresa_id = ${empresa_id}
              AND (nombre ILIKE ${'%' + nombreBuscar + '%'} OR sku = ${nombreBuscar})
            LIMIT 1
          `);

          if (byNombre.length > 0) {
            producto_id = byNombre[0].id as string;
          } else {
            // Placeholder — también marca con importacion_id para que el undo lo limpie
            const catFallback = rows(await sql`
              SELECT id FROM categorias WHERE empresa_id = ${empresa_id} LIMIT 1
            `);
            const cat_id = catFallback.length > 0 ? (catFallback[0].id as string) : null;
            const nuevoRows = rows(await sql`
              INSERT INTO productos
                (empresa_id, categoria_id, nombre, descripcion, precio_lista,
                 stock_disponible, activo, unidad_medida, importacion_id)
              VALUES
                (${empresa_id}, ${cat_id}, ${nombreBuscar}, ${nombreBuscar},
                 0, 0, true, 'UND', ${importacion_id})
              RETURNING id
            `);
            producto_id = nuevoRows[0].id as string;
            resultado.productos_creados++;
          }

          await sql`
            INSERT INTO oferta_productos (oferta_id, producto_id, cantidad, precio_unitario_referencia)
            VALUES (${oferta_id}, ${producto_id}, ${frag.cantidad}, ${frag.precio_unitario_referencia})
            ON CONFLICT (oferta_id, producto_id) DO UPDATE SET
              cantidad = EXCLUDED.cantidad,
              precio_unitario_referencia = EXCLUDED.precio_unitario_referencia
          `;
        }

        resultado.ofertas_creadas++;
      } catch (err) {
        resultado.errores.push(`Oferta "${oferta.nombre}": ${String(err)}`);
      }
    }

    return NextResponse.json({ data: resultado });
  } catch (err) {
    console.error('[catalog/import POST]', err);
    return NextResponse.json({ error: 'Error en la importación', detalle: String(err) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/catalog/import?importacion_id=xxx — deshacer una importación
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const importacion_id = searchParams.get('importacion_id');
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;

  if (!importacion_id) {
    return NextResponse.json({ error: 'importacion_id requerido' }, { status: 400 });
  }

  try {
    // 1. Eliminar filas de oferta_productos ligadas a las ofertas de este lote
    await sql`
      DELETE FROM oferta_productos
      WHERE oferta_id IN (
        SELECT id FROM ofertas
        WHERE importacion_id = ${importacion_id}
          AND empresa_id = ${empresa_id}
      )
    `;

    // 2. Eliminar las ofertas del lote
    const ofertasEliminadas = rows(await sql`
      DELETE FROM ofertas
      WHERE importacion_id = ${importacion_id}
        AND empresa_id = ${empresa_id}
      RETURNING id
    `);

    // 3. Eliminar los productos creados en este lote (no toca los actualizados)
    const productosEliminados = rows(await sql`
      DELETE FROM productos
      WHERE importacion_id = ${importacion_id}
        AND empresa_id = ${empresa_id}
      RETURNING id
    `);

    const resultado: ResultadoUndo = {
      productos_eliminados: productosEliminados.length,
      ofertas_eliminadas: ofertasEliminadas.length,
    };

    return NextResponse.json({ data: resultado });
  } catch (err) {
    console.error('[catalog/import DELETE]', err);
    return NextResponse.json({ error: 'Error al deshacer importación', detalle: String(err) }, { status: 500 });
  }
}
