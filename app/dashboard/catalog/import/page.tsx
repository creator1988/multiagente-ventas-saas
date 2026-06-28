'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import type { ProductoImport, OfertaImport, FragmentoCombo, ResultadoImport } from '@/types';

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface FilaRaw {
  CODIGO?: unknown;
  NOMBRE?: unknown;
  CATEGORIA?: unknown;
  PRECIO?: unknown;
  STOCK?: unknown;
}

interface ImagenExtraida {
  data: string;  // base64
  tipo: string;  // png | jpeg | gif | webp
}

// ---------------------------------------------------------------------------
// Extracción de imágenes desde el ZIP del .xlsx
// ---------------------------------------------------------------------------

/**
 * Parsea xl/drawings/_rels/drawing1.xml.rels y devuelve un Map rId → zipPath.
 * Ej: "rId1" → "xl/media/image1.png"
 */
function parsearRels(xml: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const re = /Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const target = m[2];
    // Target es relativo a xl/drawings/, ej: "../media/image1.png"
    const zipPath = target.startsWith('../')
      ? 'xl/' + target.slice(3)
      : 'xl/drawings/' + target;
    mapa.set(m[1], zipPath);
  }
  return mapa;
}

/**
 * Parsea xl/drawings/drawing1.xml y devuelve los anclajes: { row0indexed, rId }.
 * row0indexed = 0 corresponde a la fila de cabecera del Excel.
 */
function parsearAnclajes(xml: string): Array<{ row: number; rId: string }> {
  const resultado: Array<{ row: number; rId: string }> = [];

  // Captura bloques de anclaje (twoCellAnchor u oneCellAnchor)
  const anchorRe = /<xdr:(twoCellAnchor|oneCellAnchor)[^>]*>[\s\S]*?<\/xdr:\1>/g;
  let anchorMatch;
  while ((anchorMatch = anchorRe.exec(xml)) !== null) {
    const bloque = anchorMatch[0];

    // Fila de la imagen: primer <xdr:row> dentro de <xdr:from>
    const fromBloque = /<xdr:from>([\s\S]*?)<\/xdr:from>/.exec(bloque);
    if (!fromBloque) continue;
    const rowMatch = /<xdr:row>(\d+)<\/xdr:row>/.exec(fromBloque[1]);
    if (!rowMatch) continue;
    const row = parseInt(rowMatch[1], 10);

    // rId del blip (imagen embebida)
    const ridMatch = /r:embed="([^"]+)"/.exec(bloque);
    if (!ridMatch) continue;

    resultado.push({ row, rId: ridMatch[1] });
  }
  return resultado;
}

/**
 * Abre el .xlsx como ZIP y extrae las imágenes embebidas.
 * Devuelve un Map donde la clave es el índice 0-based dentro del array de filas
 * (0 = primera fila de datos, NO el encabezado).
 */
async function extraerImagenesDesdeZip(
  buffer: ArrayBuffer
): Promise<Map<number, ImagenExtraida>> {
  const mapa = new Map<number, ImagenExtraida>();

  try {
    const zip = await JSZip.loadAsync(buffer);

    const drawingFile = zip.file('xl/drawings/drawing1.xml');
    const relsFile = zip.file('xl/drawings/_rels/drawing1.xml.rels');
    if (!drawingFile || !relsFile) return mapa;

    const [drawingXml, relsXml] = await Promise.all([
      drawingFile.async('string'),
      relsFile.async('string'),
    ]);

    const ridToPath = parsearRels(relsXml);
    const anclajes = parsearAnclajes(drawingXml);

    await Promise.all(
      anclajes.map(async ({ row, rId }) => {
        const mediaPath = ridToPath.get(rId);
        if (!mediaPath) return;

        const mediaFile = zip.file(mediaPath);
        if (!mediaFile) return;

        const base64 = await mediaFile.async('base64');
        const ext = mediaPath.split('.').pop()?.toLowerCase() ?? 'png';
        const tipo = ext === 'jpg' ? 'jpeg' : ext;

        // row es 0-indexed en el XML: row=0 es la cabecera del Excel.
        // filas[0] corresponde a row=1, filas[1] a row=2, etc.
        const filaIndex = row - 1;
        if (filaIndex >= 0) {
          mapa.set(filaIndex, { data: base64, tipo });
        }
      })
    );
  } catch (err) {
    console.warn('[extraerImagenes] Error procesando ZIP del xlsx:', err);
  }

  return mapa;
}

// ---------------------------------------------------------------------------
// Helpers de parseo de filas
// ---------------------------------------------------------------------------

const REGEX_PREFIJO =
  /^(PROMO\s+\d+\s+(LLEVA|INCLUYE|X\s+LLEVA|X\s+INCLUYE)\s*:?\s*|COMBO\s*:?\s*|INCLUYE\s*:?\s*)/i;

function limpiarNombre(nombre: string): string {
  return nombre.replace(REGEX_PREFIJO, '').trim();
}

function esCombo(nombre: string): boolean {
  return nombre.includes('+');
}

function parsearFragmentos(nombre: string): FragmentoCombo[] {
  return nombre
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((parte) => {
      const matchPre = parte.match(/^(\d+)\s+(.+)/);
      const matchPost = parte.match(/^(.+?)\s+[xX](\d+)$/);
      if (matchPre) {
        return {
          texto_original: parte,
          nombre_producto: matchPre[2].trim(),
          cantidad: parseInt(matchPre[1], 10),
          precio_unitario_referencia: 0,
        };
      }
      if (matchPost) {
        return {
          texto_original: parte,
          nombre_producto: matchPost[1].trim(),
          cantidad: parseInt(matchPost[2], 10),
          precio_unitario_referencia: 0,
        };
      }
      return {
        texto_original: parte,
        nombre_producto: parte,
        cantidad: 1,
        precio_unitario_referencia: 0,
      };
    });
}

// ---------------------------------------------------------------------------
// Parseo completo del Excel (async para esperar extracción de imágenes)
// ---------------------------------------------------------------------------

async function parsearExcel(
  buffer: ArrayBuffer
): Promise<{ productos: ProductoImport[]; ofertas: OfertaImport[] }> {
  // Extraer imágenes primero (independiente de SheetJS)
  const imagenesPorFila = await extraerImagenesDesdeZip(buffer);

  // Parsear filas con SheetJS
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wb = XLSX.read(buffer, { type: 'array', dense: true } as any);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json<FilaRaw>(ws);

  const productos: ProductoImport[] = [];
  const ofertas: OfertaImport[] = [];

  filas.forEach((fila, idx) => {
    const nombreOriginal = String(fila.NOMBRE ?? '').trim();
    if (!nombreOriginal) return;

    const nombreLimpio = limpiarNombre(nombreOriginal);
    const imagen = imagenesPorFila.get(idx); // idx 0-based = filas[idx]

    if (esCombo(nombreLimpio)) {
      ofertas.push({
        nombre: nombreLimpio
          .split('+')
          .map((p) => p.trim())
          .slice(0, 3)
          .join(' + '),
        nombre_original: nombreOriginal,
        precio_combo: Number(fila.PRECIO ?? 0),
        fragmentos: parsearFragmentos(nombreLimpio),
        imagen_base64: imagen?.data,
        imagen_tipo: imagen?.tipo,
        fila_numero: idx + 2, // +2: header ocupa fila 1
      });
    } else {
      productos.push({
        sku: String(fila.CODIGO ?? '').trim(),
        nombre: nombreLimpio,
        nombre_original: nombreOriginal,
        categoria: String(fila.CATEGORIA ?? 'General').trim(),
        precio: Number(fila.PRECIO ?? 0),
        stock: Number(fila.STOCK ?? 0),
        imagen_base64: imagen?.data,
        imagen_tipo: imagen?.tipo,
        fila_numero: idx + 2,
      });
    }
  });

  return { productos, ofertas };
}

// ---------------------------------------------------------------------------
// Componente de miniatura
// ---------------------------------------------------------------------------

function Miniatura({ base64, tipo }: { base64?: string; tipo?: string }) {
  if (!base64) return <span className="text-gray-300 text-xs">—</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`data:image/${tipo ?? 'png'};base64,${base64}`}
      alt="imagen"
      className="w-12 h-12 object-cover rounded border border-gray-200"
    />
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

type Paso = 1 | 2 | 3 | 4;

export default function ImportarCatalogoPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [paso, setPaso] = useState<Paso>(1);
  const [archivoNombre, setArchivoNombre] = useState('');
  const [productos, setProductos] = useState<ProductoImport[]>([]);
  const [ofertas, setOfertas] = useState<OfertaImport[]>([]);
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImport | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const procesarArchivo = useCallback(async (file: File) => {
    if (!file.name.endsWith('.xlsx')) {
      alert('Solo se aceptan archivos .xlsx');
      return;
    }
    setArchivoNombre(file.name);
    setCargando(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = await parsearExcel(buffer);
      setProductos(parsed.productos);
      setOfertas(parsed.ofertas);
      setPaso(2);
    } catch (err) {
      alert(`Error leyendo el archivo: ${String(err)}`);
    } finally {
      setCargando(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void procesarArchivo(file);
    },
    [procesarArchivo]
  );

  const actualizarFragmento = (
    ofertaIdx: number,
    fragIdx: number,
    campo: keyof FragmentoCombo,
    valor: string | number
  ) => {
    setOfertas((prev) =>
      prev.map((o, oi) =>
        oi !== ofertaIdx
          ? o
          : {
              ...o,
              fragmentos: o.fragmentos.map((f, fi) =>
                fi !== fragIdx ? f : { ...f, [campo]: valor }
              ),
            }
      )
    );
  };

  const importar = async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/catalog/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productos, ofertas }),
      });
      const json = (await res.json()) as { data?: ResultadoImport; error?: string };
      if (json.data) {
        setResultado(json.data);
        setPaso(4);
      } else {
        alert(`Error: ${json.error ?? 'desconocido'}`);
      }
    } catch (err) {
      alert(`Error de red: ${String(err)}`);
    } finally {
      setCargando(false);
    }
  };

  // Calculado aquí para evitar repetición en el render único
  const totalImagenes = [...productos, ...ofertas].filter((r) => r.imagen_base64).length;

  // Un solo return con keys explícitas por paso para que React haga
  // unmount/remount completo en cada transición (evita el error removeChild
  // al pasar de la tabla del paso 2 a los divs del paso 3).
  return (
    <>
      {/* ---- Paso 1: Drop zone ---- */}
      {paso === 1 && (
        <div key="paso-1" className="p-6 max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Link href="/dashboard/catalog" className="text-gray-400 hover:text-gray-600 text-sm">
              ← Catálogo
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Importar catálogo Excel</h1>
          </div>

          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => !cargando && inputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-16 text-center transition-colors ${
              cargando
                ? 'border-blue-400 bg-blue-50 cursor-wait'
                : dragOver
                ? 'border-blue-500 bg-blue-50 cursor-pointer'
                : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50 cursor-pointer'
            }`}
          >
            {cargando ? (
              <>
                <div className="inline-block w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-gray-600 font-medium">Procesando Excel e imágenes…</p>
              </>
            ) : (
              <>
                <div className="text-5xl mb-4">📊</div>
                <p className="text-lg font-medium text-gray-700 mb-1">Arrastra tu archivo Excel aquí</p>
                <p className="text-sm text-gray-500 mb-4">o haz clic para seleccionar</p>
                <span className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  Seleccionar archivo .xlsx
                </span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) void procesarArchivo(e.target.files[0]); }}
            />
          </div>

          <div className="mt-6 bg-gray-50 rounded-lg p-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Columnas requeridas en el Excel:</p>
            <div className="flex flex-wrap gap-2">
              {['CODIGO', 'NOMBRE', 'CATEGORIA', 'PRECIO', 'STOCK'].map((col) => (
                <span key={col} className="bg-white border border-gray-200 text-gray-700 text-xs px-2 py-1 rounded font-mono">
                  {col}
                </span>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Filas cuyo NOMBRE contenga <strong>+</strong> se detectan automáticamente como combos.
              Las imágenes incrustadas en el Excel se extraen y asocian a cada fila.
            </p>
          </div>
        </div>
      )}

      {/* ---- Paso 2: Vista previa ---- */}
      {paso === 2 && (
        <div key="paso-2" className="p-6 max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Vista previa — {archivoNombre}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {productos.length} productos · {ofertas.length} combos ·{' '}
                <span className={totalImagenes > 0 ? 'text-green-600 font-medium' : ''}>
                  {totalImagenes} imágenes detectadas
                </span>
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setPaso(1)}
                className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm"
              >
                Cambiar archivo
              </button>
              <button
                onClick={() => (ofertas.length > 0 ? setPaso(3) : setPaso(4))}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                {ofertas.length > 0 ? 'Confirmar combos →' : 'Revisar e importar →'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left font-medium text-gray-600">Fila</th>
                  <th className="px-3 py-3 text-center font-medium text-gray-600">Imagen</th>
                  <th className="px-3 py-3 text-left font-medium text-gray-600">SKU</th>
                  <th className="px-3 py-3 text-left font-medium text-gray-600">Nombre</th>
                  <th className="px-3 py-3 text-left font-medium text-gray-600">Tipo</th>
                  <th className="px-3 py-3 text-left font-medium text-gray-600">Categoría</th>
                  <th className="px-3 py-3 text-right font-medium text-gray-600">Precio</th>
                  <th className="px-3 py-3 text-right font-medium text-gray-600">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {productos.map((p) => (
                  <tr key={p.fila_numero} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-400 text-xs">{p.fila_numero}</td>
                    <td className="px-3 py-2 text-center">
                      <Miniatura base64={p.imagen_base64} tipo={p.imagen_tipo} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{p.sku}</td>
                    <td className="px-3 py-2 text-gray-900 max-w-xs truncate" title={p.nombre}>
                      {p.nombre}
                    </td>
                    <td className="px-3 py-2">
                      <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">
                        Producto
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{p.categoria}</td>
                    <td className="px-3 py-2 text-right text-gray-900">
                      ${Number(p.precio).toLocaleString('es-CO')}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">{p.stock}</td>
                  </tr>
                ))}
                {ofertas.map((o) => (
                  <tr key={o.fila_numero} className="bg-purple-50/40 hover:bg-purple-50">
                    <td className="px-3 py-2 text-gray-400 text-xs">{o.fila_numero}</td>
                    <td className="px-3 py-2 text-center">
                      <Miniatura base64={o.imagen_base64} tipo={o.imagen_tipo} />
                    </td>
                    <td className="px-3 py-2 text-gray-400 text-xs">—</td>
                    <td className="px-3 py-2 text-gray-900 max-w-xs truncate" title={o.nombre}>
                      {o.nombre}
                    </td>
                    <td className="px-3 py-2">
                      <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full">
                        Combo
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-400">—</td>
                    <td className="px-3 py-2 text-right text-gray-900">
                      ${Number(o.precio_combo).toLocaleString('es-CO')}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-400">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- Paso 3: Confirmar componentes de combos ---- */}
      {paso === 3 && (
        <div key="paso-3" className="p-6 max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Confirmar componentes de combos</h1>
              <p className="text-sm text-gray-500 mt-1">
                Revisa los productos que forman cada combo. Edita el nombre si es necesario.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setPaso(2)}
                className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm"
              >
                ← Volver
              </button>
              <button
                onClick={() => setPaso(4)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Revisar e importar →
              </button>
            </div>
          </div>

          <div className="space-y-6">
            {ofertas.map((oferta, oi) => (
              <div key={oi} className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-start gap-4 mb-4">
                  {oferta.imagen_base64 && (
                    <Miniatura base64={oferta.imagen_base64} tipo={oferta.imagen_tipo} />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full mr-2">
                          Combo
                        </span>
                        <span className="font-semibold text-gray-900">{oferta.nombre}</span>
                      </div>
                      <span className="text-green-700 font-semibold">
                        ${Number(oferta.precio_combo).toLocaleString('es-CO')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 italic">
                      &ldquo;{oferta.nombre_original}&rdquo;
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  {oferta.fragmentos.map((frag, fi) => (
                    <div key={fi} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                      <span className="text-xs text-gray-400 w-5">{fi + 1}.</span>
                      <div className="flex-1">
                        <label className="text-xs text-gray-500 block mb-1">Nombre del producto</label>
                        <input
                          type="text"
                          value={frag.nombre_producto}
                          onChange={(e) =>
                            actualizarFragmento(oi, fi, 'nombre_producto', e.target.value)
                          }
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="w-24">
                        <label className="text-xs text-gray-500 block mb-1">Cantidad</label>
                        <input
                          type="number"
                          min={1}
                          value={frag.cantidad}
                          onChange={(e) =>
                            actualizarFragmento(oi, fi, 'cantidad', parseInt(e.target.value) || 1)
                          }
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="w-28">
                        <label className="text-xs text-gray-500 block mb-1">Precio ref.</label>
                        <input
                          type="number"
                          min={0}
                          value={frag.precio_unitario_referencia}
                          onChange={(e) =>
                            actualizarFragmento(
                              oi,
                              fi,
                              'precio_unitario_referencia',
                              parseFloat(e.target.value) || 0
                            )
                          }
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Paso 4: Resultado (tras importar) ---- */}
      {paso === 4 && resultado && (
        <div key="paso-4-result" className="p-6 max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">✅</div>
          <h1 className="text-2xl font-bold text-gray-900">¡Importación completada!</h1>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
            <p className="text-3xl font-bold text-green-700">{resultado.productos_creados}</p>
            <p className="text-sm text-green-600 mt-1">Productos creados</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-center">
            <p className="text-3xl font-bold text-blue-700">{resultado.productos_actualizados}</p>
            <p className="text-sm text-blue-600 mt-1">Productos actualizados</p>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 text-center">
            <p className="text-3xl font-bold text-purple-700">{resultado.ofertas_creadas}</p>
            <p className="text-sm text-purple-600 mt-1">Combos creados</p>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 text-center">
            <p className="text-3xl font-bold text-orange-700">{resultado.imagenes_subidas}</p>
            <p className="text-sm text-orange-600 mt-1">Imágenes subidas</p>
          </div>
        </div>

        {resultado.errores.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-sm font-medium text-red-700 mb-2">
              Errores ({resultado.errores.length}):
            </p>
            <ul className="space-y-1">
              {resultado.errores.map((e, i) => (
                <li key={i} className="text-xs text-red-600">
                  • {e}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-3">
          <Link
            href="/dashboard/catalog"
            className="flex-1 bg-blue-600 text-white px-4 py-3 rounded-lg text-sm font-medium text-center"
          >
            Ver catálogo
          </Link>
          <button
            onClick={() => {
              setPaso(1);
              setResultado(null);
              setProductos([]);
              setOfertas([]);
            }}
            className="flex-1 border border-gray-300 text-gray-600 px-4 py-3 rounded-lg text-sm"
          >
            Importar otro archivo
          </button>
        </div>
        </div>
      )}

      {/* ---- Paso 4: Confirmación antes de importar ---- */}
      {paso === 4 && !resultado && (
        <div key="paso-4-confirm" className="p-6 max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Confirmar importación</h1>
            <button
              onClick={() => setPaso(ofertas.length > 0 ? 3 : 2)}
              className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm"
            >
              ← Volver
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
              <p className="text-3xl font-bold text-green-700">{productos.length}</p>
              <p className="text-sm text-green-600 mt-1">Productos</p>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 text-center">
              <p className="text-3xl font-bold text-purple-700">{ofertas.length}</p>
              <p className="text-sm text-purple-600 mt-1">Combos</p>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 text-center">
              <p className="text-3xl font-bold text-orange-700">{totalImagenes}</p>
              <p className="text-sm text-orange-600 mt-1">Imágenes</p>
            </div>
          </div>

          <p className="text-sm text-gray-600 mb-6">
            Al confirmar, se crearán o actualizarán los registros en Neon y se subirán las imágenes a
            Vercel Blob.
          </p>

          <button
            onClick={importar}
            disabled={cargando}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
          >
            {cargando ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Importando…
              </>
            ) : (
              'Importar a catálogo'
            )}
          </button>
        </div>
      )}
    </>
  );
}
