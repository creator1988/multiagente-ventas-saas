'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Producto } from '@/types';

type ProductoConCategoria = Producto & { categoria_nombre: string };

interface Componente {
  cantidad: number;
  producto_nombre: string;
  sku: string | null;
}

interface Oferta {
  id: string;
  nombre: string;
  precio_combo: number;
  url_imagen: string | null;
  activo: boolean;
  componentes: Componente[];
}

type Pestaña = 'productos' | 'ofertas';

export default function CatalogPage() {
  const [pestaña, setPestaña] = useState<Pestaña>('productos');

  // --- Productos ---
  const [productos, setProductos] = useState<ProductoConCategoria[]>([]);
  const [loadingProd, setLoadingProd] = useState(true);
  const [errorProd, setErrorProd] = useState<string | null>(null);
  const [editandoProd, setEditandoProd] = useState<string | null>(null);
  const [valoresProd, setValoresProd] = useState<{ precio_lista: number; stock_disponible: number }>({
    precio_lista: 0,
    stock_disponible: 0,
  });
  const [limpiando, setLimpiando] = useState(false);
  const [resultadoLimpieza, setResultadoLimpieza] = useState<{ actualizados: number; total: number } | null>(null);

  // --- Ofertas ---
  const [ofertas, setOfertas] = useState<Oferta[]>([]);
  const [loadingOfertas, setLoadingOfertas] = useState(true);
  const [errorOfertas, setErrorOfertas] = useState<string | null>(null);
  const [editandoOferta, setEditandoOferta] = useState<string | null>(null);
  const [precioOferta, setPrecioOferta] = useState<number>(0);

  async function cargarProductos() {
    setErrorProd(null);
    try {
      const res = await fetch('/api/products');
      const json = await res.json() as { data?: ProductoConCategoria[]; error?: string; detalle?: string };
      if (!res.ok || json.error) {
        setErrorProd(json.detalle ?? json.error ?? `Error ${res.status}`);
        setProductos([]);
      } else {
        setProductos(json.data ?? []);
      }
    } catch (err) {
      setErrorProd(String(err));
    } finally {
      setLoadingProd(false);
    }
  }

  async function cargarOfertas() {
    setErrorOfertas(null);
    try {
      const res = await fetch('/api/offers');
      const json = await res.json() as { data?: Oferta[]; error?: string; detalle?: string };
      if (!res.ok || json.error) {
        setErrorOfertas(json.detalle ?? json.error ?? `Error ${res.status}`);
        setOfertas([]);
      } else {
        setOfertas(json.data ?? []);
      }
    } catch (err) {
      setErrorOfertas(String(err));
    } finally {
      setLoadingOfertas(false);
    }
  }

  useEffect(() => {
    cargarProductos();
    cargarOfertas();
  }, []);

  async function limpiarNombres() {
    setLimpiando(true);
    setResultadoLimpieza(null);
    try {
      const res = await fetch('/api/catalog/clean-names', { method: 'POST' });
      const json = await res.json() as { data?: { actualizados: number; total: number }; error?: string };
      if (json.data) {
        setResultadoLimpieza(json.data);
        cargarProductos();
      }
    } finally {
      setLimpiando(false);
    }
  }

  async function guardarProducto(id: string) {
    await fetch(`/api/products?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valoresProd),
    });
    setEditandoProd(null);
    cargarProductos();
  }

  async function guardarOferta(id: string) {
    await fetch(`/api/offers?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ precio_combo: precioOferta }),
    });
    setEditandoOferta(null);
    cargarOfertas();
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Catálogo</h1>
        <div className="flex items-center gap-3">
          {pestaña === 'productos' && (
            <button
              onClick={limpiarNombres}
              disabled={limpiando || loadingProd}
              className="border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 px-3 py-2 rounded-lg text-sm"
            >
              {limpiando ? 'Limpiando…' : 'Limpiar nombres'}
            </button>
          )}
          <Link
            href="/dashboard/catalog/import"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Importar Excel
          </Link>
        </div>
      </div>

      {/* Banner limpieza */}
      {resultadoLimpieza && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 text-sm text-green-700 flex items-center justify-between">
          <span>Nombres actualizados: <strong>{resultadoLimpieza.actualizados}</strong> de {resultadoLimpieza.total} productos</span>
          <button onClick={() => setResultadoLimpieza(null)} className="text-green-500 hover:text-green-700 ml-4 text-xs">✕</button>
        </div>
      )}

      {/* Pestañas */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        <button
          onClick={() => setPestaña('productos')}
          className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
            pestaña === 'productos'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Productos ({productos.length})
        </button>
        <button
          onClick={() => setPestaña('ofertas')}
          className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
            pestaña === 'ofertas'
              ? 'border-purple-600 text-purple-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Combos / Ofertas ({ofertas.length})
        </button>
      </div>

      {/* ====== PESTAÑA PRODUCTOS ====== */}
      {pestaña === 'productos' && (
        <>
          {loadingProd && (
            <div className="flex items-center gap-3 py-12 justify-center text-gray-500">
              <span className="inline-block w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              Cargando productos…
            </div>
          )}
          {!loadingProd && errorProd && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
              <p className="text-red-700 font-medium mb-1">No se pudo cargar el catálogo</p>
              <p className="text-red-500 text-sm mb-4 font-mono">{errorProd}</p>
              <button onClick={cargarProductos} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm">Reintentar</button>
            </div>
          )}
          {!loadingProd && !errorProd && productos.length === 0 && (
            <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
              <p className="text-4xl mb-4">📦</p>
              <p className="text-lg font-medium text-gray-700 mb-2">El catálogo está vacío</p>
              <p className="text-sm text-gray-500 mb-6">Importa un archivo Excel para agregar productos y combos.</p>
              <Link href="/dashboard/catalog/import" className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium">
                Importar Excel
              </Link>
            </div>
          )}
          {!loadingProd && !errorProd && productos.length > 0 && (
            <div className="grid gap-3">
              {productos.map((p) => (
                <div key={p.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4 min-w-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.url_imagen && (
                      <img src={p.url_imagen} alt={p.nombre} className="w-12 h-12 object-cover rounded-lg border border-gray-100 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{p.nombre}</p>
                      {p.descripcion && (
                        <p className="text-xs text-gray-400 truncate mt-0.5" title={p.descripcion}>{p.descripcion}</p>
                      )}
                      <p className="text-sm text-gray-500 mt-0.5">{p.categoria_nombre} · {p.unidad_medida}</p>
                    </div>
                  </div>
                  {editandoProd === p.id ? (
                    <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                      <div>
                        <label className="text-xs text-gray-500">Precio</label>
                        <input type="number" className="block border border-gray-300 rounded px-2 py-1 w-28 text-sm"
                          value={valoresProd.precio_lista}
                          onChange={(e) => setValoresProd((v) => ({ ...v, precio_lista: Number(e.target.value) }))} />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Stock</label>
                        <input type="number" className="block border border-gray-300 rounded px-2 py-1 w-24 text-sm"
                          value={valoresProd.stock_disponible}
                          onChange={(e) => setValoresProd((v) => ({ ...v, stock_disponible: Number(e.target.value) }))} />
                      </div>
                      <button onClick={() => guardarProducto(p.id)} className="bg-green-600 text-white px-3 py-1.5 rounded text-sm">Guardar</button>
                      <button onClick={() => setEditandoProd(null)} className="text-gray-500 px-3 py-1.5 rounded text-sm border">Cancelar</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-6 flex-shrink-0 ml-4">
                      <div className="text-right">
                        <p className="font-semibold text-green-700">${Number(p.precio_lista).toLocaleString('es-CO')}</p>
                        <p className="text-sm text-gray-500">Stock: {p.stock_disponible}</p>
                      </div>
                      <button onClick={() => { setEditandoProd(p.id); setValoresProd({ precio_lista: p.precio_lista, stock_disponible: p.stock_disponible }); }}
                        className="text-blue-600 text-sm hover:underline">
                        Editar
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ====== PESTAÑA OFERTAS ====== */}
      {pestaña === 'ofertas' && (
        <>
          {loadingOfertas && (
            <div className="flex items-center gap-3 py-12 justify-center text-gray-500">
              <span className="inline-block w-5 h-5 border-2 border-gray-300 border-t-purple-500 rounded-full animate-spin" />
              Cargando combos…
            </div>
          )}
          {!loadingOfertas && errorOfertas && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
              <p className="text-red-700 font-medium mb-1">No se pudieron cargar los combos</p>
              <p className="text-red-500 text-sm mb-4 font-mono">{errorOfertas}</p>
              <button onClick={cargarOfertas} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm">Reintentar</button>
            </div>
          )}
          {!loadingOfertas && !errorOfertas && ofertas.length === 0 && (
            <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
              <p className="text-4xl mb-4">🎁</p>
              <p className="text-lg font-medium text-gray-700 mb-2">No hay combos cargados</p>
              <p className="text-sm text-gray-500 mb-6">Importa un Excel con filas que contengan &ldquo;+&rdquo; para crear combos.</p>
              <Link href="/dashboard/catalog/import" className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium">
                Importar Excel
              </Link>
            </div>
          )}
          {!loadingOfertas && !errorOfertas && ofertas.length > 0 && (
            <div className="grid gap-3">
              {ofertas.map((o) => (
                <div key={o.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0 flex-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {o.url_imagen && (
                      <img src={o.url_imagen} alt={o.nombre} className="w-14 h-14 object-cover rounded-lg border border-gray-100 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full flex-shrink-0">Combo</span>
                        <p className="font-medium text-gray-900 truncate" title={o.nombre}>{o.nombre}</p>
                      </div>
                      {o.componentes.length > 0 ? (
                        <ul className="mt-1 space-y-0.5">
                          {o.componentes.map((c, i) => (
                            <li key={i} className="text-xs text-gray-500">
                              · {c.cantidad}× {c.producto_nombre}{c.sku ? ` (${c.sku})` : ''}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-gray-400 mt-1 italic">Sin componentes vinculados</p>
                      )}
                    </div>
                  </div>
                  {editandoOferta === o.id ? (
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div>
                        <label className="text-xs text-gray-500">Precio combo</label>
                        <input type="number" className="block border border-gray-300 rounded px-2 py-1 w-32 text-sm"
                          value={precioOferta}
                          onChange={(e) => setPrecioOferta(Number(e.target.value))} />
                      </div>
                      <button onClick={() => guardarOferta(o.id)} className="bg-green-600 text-white px-3 py-1.5 rounded text-sm mt-4">Guardar</button>
                      <button onClick={() => setEditandoOferta(null)} className="text-gray-500 px-3 py-1.5 rounded text-sm border mt-4">Cancelar</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <div className="text-right">
                        <p className="font-semibold text-purple-700">${Number(o.precio_combo).toLocaleString('es-CO')}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{o.activo ? 'Activo' : 'Inactivo'}</p>
                      </div>
                      <button onClick={() => { setEditandoOferta(o.id); setPrecioOferta(Number(o.precio_combo)); }}
                        className="text-blue-600 text-sm hover:underline">
                        Editar
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
