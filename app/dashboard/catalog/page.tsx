'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Producto } from '@/types';

type ProductoConCategoria = Producto & { categoria_nombre: string };

export default function CatalogPage() {
  const [productos, setProductos] = useState<ProductoConCategoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [valores, setValores] = useState<{ precio_base: number; stock_disponible: number }>({
    precio_base: 0,
    stock_disponible: 0,
  });

  async function cargar() {
    setError(null);
    try {
      const res = await fetch('/api/products');
      const json = await res.json() as {
        data?: ProductoConCategoria[];
        error?: string;
        detalle?: string;
      };
      if (!res.ok || json.error) {
        setError(json.detalle ?? json.error ?? `Error ${res.status}`);
        setProductos([]);
      } else {
        setProductos(json.data ?? []);
      }
    } catch (err) {
      setError(String(err));
      setProductos([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, []);

  async function guardar(id: string) {
    await fetch(`/api/products?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valores),
    });
    setEditando(null);
    cargar();
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Catálogo de Productos</h1>
        <Link
          href="/dashboard/catalog/import"
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          Importar Excel
        </Link>
      </div>

      {/* Estado de carga */}
      {loading && (
        <div className="flex items-center gap-3 py-12 justify-center text-gray-500">
          <span className="inline-block w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          Cargando catálogo…
        </div>
      )}

      {/* Error de API */}
      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium mb-1">No se pudo cargar el catálogo</p>
          <p className="text-red-500 text-sm mb-4 font-mono">{error}</p>
          <button
            onClick={cargar}
            className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Estado vacío */}
      {!loading && !error && productos.length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-4xl mb-4">📦</p>
          <p className="text-lg font-medium text-gray-700 mb-2">El catálogo está vacío</p>
          <p className="text-sm text-gray-500 mb-6">
            Importa un archivo Excel para agregar productos y combos.
          </p>
          <Link
            href="/dashboard/catalog/import"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
          >
            Importar Excel
          </Link>
        </div>
      )}

      {/* Lista de productos */}
      {!loading && !error && productos.length > 0 && (
        <div className="grid gap-3">
          {productos.map((p) => (
            <div
              key={p.id}
              className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-4 min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.imagen_url && (
                  <img
                    src={p.imagen_url}
                    alt={p.nombre}
                    className="w-12 h-12 object-cover rounded-lg border border-gray-100 flex-shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{p.nombre}</p>
                  <p className="text-sm text-gray-500">
                    {p.categoria_nombre} · {p.unidad}
                  </p>
                </div>
              </div>

              {editando === p.id ? (
                <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                  <div>
                    <label className="text-xs text-gray-500">Precio</label>
                    <input
                      type="number"
                      className="block border border-gray-300 rounded px-2 py-1 w-28 text-sm"
                      value={valores.precio_base}
                      onChange={(e) =>
                        setValores((v) => ({ ...v, precio_base: Number(e.target.value) }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Stock</label>
                    <input
                      type="number"
                      className="block border border-gray-300 rounded px-2 py-1 w-24 text-sm"
                      value={valores.stock_disponible}
                      onChange={(e) =>
                        setValores((v) => ({ ...v, stock_disponible: Number(e.target.value) }))
                      }
                    />
                  </div>
                  <button
                    onClick={() => guardar(p.id)}
                    className="bg-green-600 text-white px-3 py-1.5 rounded text-sm"
                  >
                    Guardar
                  </button>
                  <button
                    onClick={() => setEditando(null)}
                    className="text-gray-500 px-3 py-1.5 rounded text-sm border"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-6 flex-shrink-0 ml-4">
                  <div className="text-right">
                    <p className="font-semibold text-green-700">
                      ${Number(p.precio_base).toLocaleString('es-CO')}
                    </p>
                    <p className="text-sm text-gray-500">Stock: {p.stock_disponible}</p>
                  </div>
                  <button
                    onClick={() => {
                      setEditando(p.id);
                      setValores({
                        precio_base: p.precio_base,
                        stock_disponible: p.stock_disponible,
                      });
                    }}
                    className="text-blue-600 text-sm hover:underline"
                  >
                    Editar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
