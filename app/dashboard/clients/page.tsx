'use client';

import { useEffect, useState } from 'react';

interface ClienteConHistorial {
  id: string;
  nombre: string;
  whatsapp: string;
  credito_disponible: number;
  activo: boolean;
  ultimo_pedido?: string;
  total_pedidos?: number;
}

export default function ClientsPage() {
  const [clientes, setClientes] = useState<ClienteConHistorial[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    async function cargar() {
      const res = await fetch('/api/clients');
      const json = await res.json() as { data: ClienteConHistorial[] };
      setClientes(json.data ?? []);
      setLoading(false);
    }
    cargar();
  }, []);

  const filtrados = clientes.filter(
    (c) =>
      c.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      c.whatsapp.includes(busqueda)
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Clientes</h1>

      <input
        type="search"
        placeholder="Buscar por nombre o WhatsApp..."
        className="w-full border border-gray-300 rounded-lg px-4 py-2 mb-6 text-sm"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
      />

      {loading && <p className="text-gray-500">Cargando...</p>}

      <div className="grid gap-3">
        {filtrados.map((c) => (
          <div key={c.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">{c.nombre}</p>
              <p className="text-sm text-gray-500">{c.whatsapp}</p>
            </div>
            <div className="flex items-center gap-6 text-right">
              <div>
                <p className="text-sm text-gray-500">Crédito disponible</p>
                <p className="font-semibold text-green-700">${Number(c.credito_disponible).toLocaleString('es-CO')}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Pedidos</p>
                <p className="font-semibold">{c.total_pedidos ?? 0}</p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs ${c.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {c.activo ? 'Activo' : 'Inactivo'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
