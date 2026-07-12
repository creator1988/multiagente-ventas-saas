'use client';

import { Fragment, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { VPedidoHoy, PedidoDetalle } from '@/types';

const ESTADO_COLORES: Record<string, string> = {
  pendiente: 'bg-yellow-100 text-yellow-800',
  confirmado: 'bg-blue-100 text-blue-800',
  en_preparacion: 'bg-orange-100 text-orange-800',
  despachado: 'bg-purple-100 text-purple-800',
  entregado: 'bg-green-100 text-green-800',
  cancelado: 'bg-red-100 text-red-800',
};

const ESTADOS_FILTRO = ['nuevo', 'confirmado', 'despachado', 'entregado', 'cancelado'];

// Botones de acción del panel de detalle → estado real en la tabla pedidos.
// "En ruta" mapea a 'despachado' (el pedido ya salió hacia el cliente).
const ACCIONES_ESTADO: Array<{ label: string; estado: string; clase: string }> = [
  { label: 'Confirmar', estado: 'confirmado', clase: 'bg-blue-600 hover:bg-blue-700' },
  { label: 'En ruta', estado: 'despachado', clase: 'bg-purple-600 hover:bg-purple-700' },
  { label: 'Entregado', estado: 'entregado', clase: 'bg-green-600 hover:bg-green-700' },
  { label: 'Cancelar', estado: 'cancelado', clase: 'bg-red-600 hover:bg-red-700' },
];

// ---------------------------------------------------------------------------
// Hook compartido: expandir fila → cargar detalle → cambiar estado.
// Reutilizado por "Pedidos de hoy" y "Historial de pedidos", cada uno con
// su propia lista y su propio estado de expansión independiente.
// ---------------------------------------------------------------------------
function useDetallePedidos(setPedidos: Dispatch<SetStateAction<VPedidoHoy[]>>) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detalles, setDetalles] = useState<Record<string, PedidoDetalle>>({});
  const [cargandoDetalle, setCargandoDetalle] = useState<string | null>(null);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
  const [actualizandoEstado, setActualizandoEstado] = useState<string | null>(null);

  async function cargarDetalle(pedidoId: string) {
    setCargandoDetalle(pedidoId);
    setErrorDetalle(null);
    try {
      const res = await fetch(`/api/orders?id=${pedidoId}`);
      const json = (await res.json()) as { data?: PedidoDetalle; error?: string };
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

  return { expandedId, detalles, cargandoDetalle, errorDetalle, actualizandoEstado, toggleExpand, cambiarEstado };
}

// ---------------------------------------------------------------------------
// Fila de pedido + panel de detalle expandible (compartido entre ambas secciones)
// ---------------------------------------------------------------------------
function FilaPedido({
  pedido,
  expandido,
  detalle,
  cargando,
  error,
  actualizando,
  onToggle,
  onCambiarEstado,
  mostrarFechaCompleta,
}: {
  pedido: VPedidoHoy;
  expandido: boolean;
  detalle?: PedidoDetalle;
  cargando: boolean;
  error: string | null;
  actualizando: boolean;
  onToggle: () => void;
  onCambiarEstado: (estado: string) => void;
  mostrarFechaCompleta: boolean;
}) {
  return (
    <Fragment>
      <tr onClick={onToggle} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
        <td className="py-3 pr-4 font-medium">{pedido.cliente_nombre}</td>
        <td className="py-3 pr-4 text-sm text-gray-600">{pedido.whatsapp}</td>
        <td className="py-3 pr-4 text-sm">{pedido.items_count}</td>
        <td className="py-3 pr-4 font-semibold text-green-700">
          ${Number(pedido.total).toLocaleString('es-CO')}
        </td>
        <td className="py-3 pr-4">
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${ESTADO_COLORES[pedido.estado] ?? 'bg-gray-100'}`}>
            {pedido.estado}
          </span>
        </td>
        <td className="py-3 text-sm text-gray-500">
          {mostrarFechaCompleta
            ? new Date(pedido.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
            : new Date(pedido.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
        </td>
      </tr>

      {expandido && (
        <tr className="border-b border-gray-100 bg-gray-50">
          <td colSpan={6} className="px-4 py-4">
            {cargando && <p className="text-sm text-gray-500">Cargando detalle...</p>}
            {!cargando && error && !detalle && <p className="text-sm text-red-500">{error}</p>}
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
                          onCambiarEstado(accion.estado);
                        }}
                        disabled={actualizando || detalle.estado === accion.estado}
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
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  // --- Pedidos de hoy ---
  const [pedidos, setPedidos] = useState<VPedidoHoy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const hoy = useDetallePedidos(setPedidos);

  useEffect(() => {
    async function cargar() {
      try {
        const res = await fetch('/api/orders?fecha=hoy');
        const json = (await res.json()) as { data: VPedidoHoy[] };
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

  // --- Historial de pedidos ---
  const [historialPedidos, setHistorialPedidos] = useState<VPedidoHoy[]>([]);
  const [historialLoading, setHistorialLoading] = useState(true);
  const [historialError, setHistorialError] = useState('');
  const [historialTotal, setHistorialTotal] = useState(0);
  const [historialPagina, setHistorialPagina] = useState(1);
  const LIMITE = 20;

  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [buscarInput, setBuscarInput] = useState('');
  const [filtroBuscar, setFiltroBuscar] = useState('');

  const historial = useDetallePedidos(setHistorialPedidos);

  useEffect(() => {
    async function cargarHistorial() {
      setHistorialLoading(true);
      setHistorialError('');
      try {
        const params = new URLSearchParams({ historial: 'true', pagina: String(historialPagina), limite: String(LIMITE) });
        if (filtroDesde) params.set('desde', filtroDesde);
        if (filtroHasta) params.set('hasta', filtroHasta);
        if (filtroEstado) params.set('estado', filtroEstado);
        if (filtroBuscar) params.set('buscar', filtroBuscar);

        const res = await fetch(`/api/orders?${params.toString()}`);
        const json = (await res.json()) as { data?: VPedidoHoy[]; total?: number; error?: string };
        if (json.data) {
          setHistorialPedidos(json.data);
          setHistorialTotal(json.total ?? 0);
        } else {
          setHistorialError(json.error ?? 'Error cargando historial');
        }
      } catch {
        setHistorialError('Error de red cargando historial');
      } finally {
        setHistorialLoading(false);
      }
    }
    cargarHistorial();
  }, [historialPagina, filtroDesde, filtroHasta, filtroEstado, filtroBuscar]);

  const totalPaginas = Math.max(Math.ceil(historialTotal / LIMITE), 1);

  function aplicarBusqueda() {
    setHistorialPagina(1);
    setFiltroBuscar(buscarInput.trim());
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-10">
      {/* ======================= PEDIDOS DE HOY ======================= */}
      <div>
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

        {!loading && pedidos.length > 0 && (
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
                  <FilaPedido
                    key={p.pedido_id}
                    pedido={p}
                    expandido={hoy.expandedId === p.pedido_id}
                    detalle={hoy.detalles[p.pedido_id]}
                    cargando={hoy.cargandoDetalle === p.pedido_id}
                    error={hoy.errorDetalle}
                    actualizando={hoy.actualizandoEstado === p.pedido_id}
                    onToggle={() => hoy.toggleExpand(p.pedido_id)}
                    onCambiarEstado={(estado) => hoy.cambiarEstado(p.pedido_id, estado)}
                    mostrarFechaCompleta={false}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ======================= HISTORIAL DE PEDIDOS ======================= */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-4">Historial de pedidos</h2>

        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Desde</label>
            <input
              type="date"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              value={filtroDesde}
              onChange={(e) => { setFiltroDesde(e.target.value); setHistorialPagina(1); }}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Hasta</label>
            <input
              type="date"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              value={filtroHasta}
              onChange={(e) => { setFiltroHasta(e.target.value); setHistorialPagina(1); }}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Estado</label>
            <select
              className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
              value={filtroEstado}
              onChange={(e) => { setFiltroEstado(e.target.value); setHistorialPagina(1); }}
            >
              <option value="">Todos</option>
              {ESTADOS_FILTRO.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-gray-500 block mb-1">Cliente (nombre o WhatsApp)</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Buscar..."
                className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
                value={buscarInput}
                onChange={(e) => setBuscarInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') aplicarBusqueda(); }}
              />
              <button
                onClick={aplicarBusqueda}
                className="bg-gray-700 hover:bg-gray-800 text-white px-3 py-1.5 rounded-lg text-sm"
              >
                Buscar
              </button>
            </div>
          </div>
          {(filtroDesde || filtroHasta || filtroEstado || filtroBuscar) && (
            <button
              onClick={() => {
                setFiltroDesde('');
                setFiltroHasta('');
                setFiltroEstado('');
                setBuscarInput('');
                setFiltroBuscar('');
                setHistorialPagina(1);
              }}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Limpiar filtros
            </button>
          )}
        </div>

        {historialLoading && <p className="text-gray-500">Cargando...</p>}
        {historialError && <p className="text-red-500">{historialError}</p>}

        {!historialLoading && !historialError && historialPedidos.length === 0 && (
          <p className="text-gray-400 text-center py-12">No hay pedidos con estos filtros.</p>
        )}

        {!historialLoading && historialPedidos.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-sm text-gray-500">
                    <th className="py-3 pr-4">Cliente</th>
                    <th className="py-3 pr-4">WhatsApp</th>
                    <th className="py-3 pr-4">Items</th>
                    <th className="py-3 pr-4">Total</th>
                    <th className="py-3 pr-4">Estado</th>
                    <th className="py-3">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {historialPedidos.map((p) => (
                    <FilaPedido
                      key={p.pedido_id}
                      pedido={p}
                      expandido={historial.expandedId === p.pedido_id}
                      detalle={historial.detalles[p.pedido_id]}
                      cargando={historial.cargandoDetalle === p.pedido_id}
                      error={historial.errorDetalle}
                      actualizando={historial.actualizandoEstado === p.pedido_id}
                      onToggle={() => historial.toggleExpand(p.pedido_id)}
                      onCambiarEstado={(estado) => historial.cambiarEstado(p.pedido_id, estado)}
                      mostrarFechaCompleta={true}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-500">
                {historialTotal} pedido(s) · Página {historialPagina} de {totalPaginas}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setHistorialPagina((p) => Math.max(p - 1, 1))}
                  disabled={historialPagina <= 1}
                  className="border border-gray-300 text-gray-600 disabled:opacity-40 px-3 py-1.5 rounded-lg text-sm"
                >
                  ← Anterior
                </button>
                <button
                  onClick={() => setHistorialPagina((p) => Math.min(p + 1, totalPaginas))}
                  disabled={historialPagina >= totalPaginas}
                  className="border border-gray-300 text-gray-600 disabled:opacity-40 px-3 py-1.5 rounded-lg text-sm"
                >
                  Siguiente →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
