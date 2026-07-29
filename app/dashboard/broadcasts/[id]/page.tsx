'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface BroadcastResumen {
  id: string;
  name: string;
  status: string;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  pending_count: number;
  responded_count: number;
  response_rate: number;
  total_recipients: number;
  created_at: string;
}

interface Destinatario {
  id: string;
  phone_number: string;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  error_message: string | null;
}

const ESTADOS = [
  { valor: 'all', etiqueta: 'Todos' },
  { valor: 'sent', etiqueta: 'Enviado' },
  { valor: 'delivered', etiqueta: 'Entregado' },
  { valor: 'read', etiqueta: 'Leído' },
  { valor: 'failed', etiqueta: 'Fallido' },
  { valor: 'pending', etiqueta: 'Pendiente' },
];

const ESTADO_BADGE: Record<string, string> = {
  sent: 'bg-blue-100 text-blue-700',
  delivered: 'bg-indigo-100 text-indigo-700',
  read: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  pending: 'bg-gray-100 text-gray-600',
};

function fmt(fecha: string | null): string {
  return fecha ? new Date(fecha).toLocaleString('es-CO') : '—';
}

export default function BroadcastDetallePage({ params }: { params: { id: string } }) {
  const { id } = params;

  const [broadcast, setBroadcast] = useState<BroadcastResumen | null>(null);
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('all');

  const cargar = useCallback(async (estado: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = estado !== 'all' ? `?status=${estado}` : '';
      const res = await fetch(`/api/broadcasts/${id}/recipients${qs}`);
      const json = (await res.json()) as {
        data?: Destinatario[];
        broadcast?: BroadcastResumen;
        error?: string;
        detalle?: string;
      };
      if (!res.ok || json.error) {
        setError(json.detalle ?? json.error ?? `Error ${res.status}`);
        setDestinatarios([]);
      } else {
        setDestinatarios(json.data ?? []);
        if (json.broadcast) setBroadcast(json.broadcast);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    cargar(filtro);
  }, [cargar, filtro]);

  function exportarCsv() {
    const qs = filtro !== 'all' ? `?status=${filtro}&format=csv` : '?format=csv';
    window.location.href = `/api/broadcasts/${id}/recipients${qs}`;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/dashboard/broadcasts" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
        ← Volver a transmisiones
      </Link>

      {broadcast && (
        <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
          <h1 className="text-xl font-bold text-gray-900 mb-1">{broadcast.name}</h1>
          <p className="text-xs text-gray-500 mb-4">
            Estado: <span className="font-medium">{broadcast.status}</span> · Creada {fmt(broadcast.created_at)}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
            <div className="bg-gray-50 rounded-lg py-2">
              <p className="text-lg font-semibold text-gray-900">{broadcast.total_recipients}</p>
              <p className="text-xs text-gray-500">Total</p>
            </div>
            <div className="bg-blue-50 rounded-lg py-2">
              <p className="text-lg font-semibold text-blue-700">{broadcast.sent_count}</p>
              <p className="text-xs text-gray-500">Enviados</p>
            </div>
            <div className="bg-indigo-50 rounded-lg py-2">
              <p className="text-lg font-semibold text-indigo-700">{broadcast.delivered_count}</p>
              <p className="text-xs text-gray-500">Entregados</p>
            </div>
            <div className="bg-green-50 rounded-lg py-2">
              <p className="text-lg font-semibold text-green-700">{broadcast.read_count}</p>
              <p className="text-xs text-gray-500">Leídos</p>
            </div>
            <div className="bg-red-50 rounded-lg py-2">
              <p className="text-lg font-semibold text-red-700">{broadcast.failed_count}</p>
              <p className="text-xs text-gray-500">Fallidos</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {ESTADOS.map((e) => (
            <button
              key={e.valor}
              onClick={() => setFiltro(e.valor)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                filtro === e.valor
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {e.etiqueta}
            </button>
          ))}
        </div>
        <button
          onClick={exportarCsv}
          disabled={loading || destinatarios.length === 0}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          Exportar CSV{filtro !== 'all' ? ` (${ESTADOS.find((e) => e.valor === filtro)?.etiqueta.toLowerCase()})` : ''}
        </button>
      </div>

      {loading && <p className="text-gray-500 text-sm">Cargando destinatarios…</p>}

      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium mb-1">No se pudieron cargar los destinatarios</p>
          <p className="text-red-500 text-sm mb-4 font-mono">{error}</p>
          <button onClick={() => cargar(filtro)} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm">Reintentar</button>
        </div>
      )}

      {!loading && !error && destinatarios.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-10">No hay destinatarios con ese estado.</p>
      )}

      {!loading && !error && destinatarios.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2">Teléfono</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">Enviado</th>
                <th className="px-4 py-2">Entregado</th>
                <th className="px-4 py-2">Leído</th>
                <th className="px-4 py-2">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {destinatarios.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2 font-mono text-xs">{d.phone_number}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${ESTADO_BADGE[d.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">{fmt(d.sent_at)}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">{fmt(d.delivered_at)}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">{fmt(d.read_at)}</td>
                  <td className="px-4 py-2 text-xs text-red-600">{d.error_message ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
