'use client';

import { useEffect, useState } from 'react';
import type { VPedidoHoy } from '@/types';

const ESTADO_COLORES: Record<string, string> = {
  pendiente: 'bg-yellow-100 text-yellow-800',
  confirmado: 'bg-blue-100 text-blue-800',
  en_preparacion: 'bg-orange-100 text-orange-800',
  despachado: 'bg-purple-100 text-purple-800',
  entregado: 'bg-green-100 text-green-800',
  cancelado: 'bg-red-100 text-red-800',
};

export default function DashboardPage() {
  const [pedidos, setPedidos] = useState<VPedidoHoy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function cargar() {
      try {
        const res = await fetch('/api/orders?fecha=hoy');
        const json = await res.json() as { data: VPedidoHoy[] };
        setPedidos(json.data ?? []);
      } catch {
        setError('Error cargando pedidos');
      } finally {
        setLoading(false);
      }
    }
    cargar();
    const intervalo = setInterval(cargar, 30000); // refresh cada 30s
    return () => clearInterval(intervalo);
  }, []);

  const totalHoy = pedidos.reduce((acc, p) => acc + Number(p.total), 0);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pedidos de hoy</h1>
        <span className="text-lg font-semibold text-green-700">
          Total: ${totalHoy.toLocaleString('es-CO')}
        </span>
      </div>

      {loading && <p className="text-gray-500">Cargando...</p>}
      {error && <p className="text-red-500">{error}</p>}

      {!loading && pedidos.length === 0 && (
        <p className="text-gray-400 text-center py-12">No hay pedidos hoy aún.</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-left text-sm text-gray-500">
              <th className="py-3 pr-4">Cliente</th>
              <th className="py-3 pr-4">WhatsApp</th>
              <th className="py-3 pr-4">Items</th>
              <th className="py-3 pr-4">Total</th>
              <th className="py-3 pr-4">Estado</th>
              <th className="py-3">Hora</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((p) => (
              <tr key={p.pedido_id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-3 pr-4 font-medium">{p.cliente_nombre}</td>
                <td className="py-3 pr-4 text-sm text-gray-600">{p.whatsapp}</td>
                <td className="py-3 pr-4 text-sm">{p.items_count}</td>
                <td className="py-3 pr-4 font-semibold text-green-700">
                  ${Number(p.total).toLocaleString('es-CO')}
                </td>
                <td className="py-3 pr-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${ESTADO_COLORES[p.estado] ?? 'bg-gray-100'}`}>
                    {p.estado}
                  </span>
                </td>
                <td className="py-3 text-sm text-gray-500">
                  {new Date(p.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
