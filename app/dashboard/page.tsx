'use client';

import { Fragment, useEffect, useState } from 'react';
import type { VPedidoHoy, PedidoDetalle } from '@/types';

const ESTADO_COLORES: Record<string, string> = {
  pendiente: 'bg-yellow-100 text-yellow-800',
  confirmado: 'bg-blue-100 text-blue-800',
  en_preparacion: 'bg-orange-100 text-orange-800',
  despachado: 'bg-purple-100 text-purple-800',
  entregado: 'bg-green-100 text-green-800',
  cancelado: 'bg-red-100 text-red-800',
};

// Botones de acción del panel de detalle → estado real en la tabla pedidos.
// "En ruta" mapea a 'despachado' (el pedido ya salió hacia el cliente).
const ACCIONES_ESTADO: Array<{ label: string; estado: string; clase: string }> = [
  { label: 'Confirmar', estado: 'confirmado', clase: 'bg-blue-600 hover:bg-blue-700' },
  { label: 'En ruta', estado: 'despachado', clase: 'bg-purple-600 hover:bg-purple-700' },
  { label: 'Entregado', estado: 'entregado', clase: 'bg-green-600 hover:bg-green-700' },
  { label: 'Cancelar', estado: 'cancelado', clase: 'bg-red-600 hover:bg-red-700' },
];

export default function DashboardPage() {
  const [pedidos, setPedidos] = useState<VPedidoHoy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detalles, setDetalles] = useState<Record<string, PedidoDetalle>>({});
  const [cargandoDetalle, setCargandoDetalle] = useState<string | null>(null);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
  const [actualizandoEstado, setActualizandoEstado] = useState<string | null>(null);

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

  async function cargarDetalle(pedidoId: string) {
    setCargandoDetalle(pedidoId);
    setErrorDetalle(null);
    try {
      const res = await fetch(`/api/orders?id=${pedidoId}`);
      const json = await res.json() as { data?: PedidoDetalle; error?: string };
      if (json.data) {
        setDetalles((prev) => ({ ...prev, [pedidoId]: json.data! }));
      } else {
        setErrorDetalle(json.error ?? 'Error cargando el detalle');
      }
    } catch {
      setErrorDetalle('Error de red cargando el detalle');
    } finally {
      setCargandoDetalle(null);
    }
  }

  function toggleExpand(pedidoId: string) {
    if (expandedId === pedidoId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(pedidoId);
    if (!detalles[pedidoId]) {
      void cargarDetalle(pedidoId);
    }
  }

  async function cambiarEstado(pedidoId: string, nuevoEstado: string) {
    setActualizandoEstado(pedidoId);
    try {
      await fetch(`/api/orders?id=${pedidoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: nuevoEstado }),
      });
      setPedidos((prev) => prev.map((p) => (p.pedido_id === pedidoId ? { ...p, estado: nuevoEstado } : p)));
      setDetalles((prev) =>
        prev[pedidoId] ? { ...prev, [pedidoId]: { ...prev[pedidoId], estado: nuevoEstado } } : prev
      );
    } finally {
      setActualizandoEstado(null);
    }
  }

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
            {pedidos.map((p) => {
              const expandido = expandedId === p.pedido_id;
              const detalle = detalles[p.pedido_id];

              return (
                <Fragment key={p.pedido_id}>
                  <tr
                    onClick={() => toggleExpand(p.pedido_id)}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  >
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

                  {expandido && (
                    <tr key={`${p.pedido_id}-detalle`} className="border-b border-gray-100 bg-gray-50">
                      <td colSpan={6} className="px-4 py-4">
                        {cargandoDetalle === p.pedido_id && (
                          <p className="text-sm text-gray-500">Cargando detalle...</p>
                        )}
                        {!cargandoDetalle && errorDetalle && !detalle && (
                          <p className="text-sm text-red-500">{errorDetalle}</p>
                        )}
                        {detalle && (
                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                              <div>
                                <p className="font-semibold text-gray-900">
                                  Pedido {detalle.numero_pedido ? `#${detalle.numero_pedido}` : `#${detalle.pedido_id.substring(0, 8).toUpperCase()}`}
                                </p>
                                <p className="text-sm text-gray-600">{detalle.cliente_nombre} · {detalle.whatsapp}</p>
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {new Date(detalle.created_at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
                                </p>
                              </div>
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${ESTADO_COLORES[detalle.estado] ?? 'bg-gray-100'}`}>
                                {detalle.estado}
                              </span>
                            </div>

                            <table className="w-full text-sm mb-4">
                              <thead>
                                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                                  <th className="py-2 pr-4">Producto (POS)</th>
                                  <th className="py-2 pr-4 text-right">Cant.</th>
                                  <th className="py-2 pr-4 text-right">Precio unit.</th>
                                  <th className="py-2 text-right">Subtotal</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detalle.items.map((item, i) => (
                                  <tr key={i} className="border-b border-gray-50">
                                    <td className="py-2 pr-4 text-gray-900">{item.nombre_snapshot}</td>
                                    <td className="py-2 pr-4 text-right text-gray-600">{item.cantidad}</td>
                                    <td className="py-2 pr-4 text-right text-gray-600">
                                      ${Number(item.precio_unitario).toLocaleString('es-CO')}
                                    </td>
                                    <td className="py-2 text-right font-medium text-gray-900">
                                      ${Number(item.subtotal).toLocaleString('es-CO')}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>

                            <div className="flex flex-wrap items-center justify-between gap-4">
                              <p className="font-semibold text-green-700">
                                Total: ${Number(detalle.total).toLocaleString('es-CO')}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {ACCIONES_ESTADO.map((accion) => (
                                  <button
                                    key={accion.estado}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void cambiarEstado(p.pedido_id, accion.estado);
                                    }}
                                    disabled={actualizandoEstado === p.pedido_id || detalle.estado === accion.estado}
                                    className={`text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 ${accion.clase}`}
                                  >
                                    {accion.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
