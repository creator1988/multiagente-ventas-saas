'use client';

import { useEffect, useState } from 'react';
import type { Producto } from '@/types';

export default function CatalogPage() {
  const [productos, setProductos] = useState<(Producto & { categoria_nombre: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<string | null>(null);
  const [valores, setValores] = useState<{ precio_base: number; stock_disponible: number }>({ precio_base: 0, stock_disponible: 0 });

  async function cargar() {
    const res = await fetch('/api/products');
    const json = await res.json() as { data: (Producto & { categoria_nombre: string })[] };
    setProductos(json.data ?? []);
    setLoading(false);
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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Catálogo de Productos</h1>

      {loading && <p className="text-gray-500">Cargando...</p>}

      <div className="grid gap-3">
        {productos.map((p) => (
          <div key={p.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">{p.nombre}</p>
              <p className="text-sm text-gray-500">{p.categoria_nombre} · {p.unidad}</p>
            </div>

            {editando === p.id ? (
              <div className="flex items-center gap-3">
                <div>
                  <label className="text-xs text-gray-500">Precio</label>
                  <input
                    type="number"
                    className="block border border-gray-300 rounded px-2 py-1 w-28 text-sm"
                    value={valores.precio_base}
                    onChange={(e) => setValores(v => ({ ...v, precio_base: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Stock</label>
                  <input
                    type="number"
                    className="block border border-gray-300 rounded px-2 py-1 w-24 text-sm"
                    value={valores.stock_disponible}
                    onChange={(e) => setValores(v => ({ ...v, stock_disponible: Number(e.target.value) }))}
                  />
                </div>
                <button onClick={() => guardar(p.id)} className="bg-green-600 text-white px-3 py-1.5 rounded text-sm">Guardar</button>
                <button onClick={() => setEditando(null)} className="text-gray-500 px-3 py-1.5 rounded text-sm border">Cancelar</button>
              </div>
            ) : (
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="font-semibold text-green-700">${Number(p.precio_base).toLocaleString('es-CO')}</p>
                  <p className="text-sm text-gray-500">Stock: {p.stock_disponible}</p>
                </div>
                <button
                  onClick={() => {
                    setEditando(p.id);
                    setValores({ precio_base: p.precio_base, stock_disponible: p.stock_disponible });
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
    </div>
  );
}
