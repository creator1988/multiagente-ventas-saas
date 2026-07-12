'use client';

import { useEffect, useState } from 'react';

interface RutaBroadcast {
  id: string;
  nombre: string;
  total_clientes: number;
}

interface ResultadoBroadcast {
  broadcast_id: string;
  estado: string;
  total_clientes: number;
  agregados: number;
  duplicados: number;
  errores: string[];
  ofertas: string[];
}

export default function BroadcastsPage() {
  const [rutas, setRutas] = useState<RutaBroadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoBroadcast | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/broadcasts');
      const json = (await res.json()) as { data?: RutaBroadcast[]; error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? `Error ${res.status}`);
        setRutas([]);
      } else {
        setRutas(json.data ?? []);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  function toggle(id: string) {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalClientes = rutas
    .filter((r) => seleccionadas.has(r.id))
    .reduce((acc, r) => acc + Number(r.total_clientes), 0);

  async function enviarTransmision() {
    if (seleccionadas.size === 0) return;
    const confirmado = window.confirm(
      `¿Enviar la transmisión a ${totalClientes} cliente(s) de ${seleccionadas.size} ruta(s)? Esto dispara mensajes reales de WhatsApp a través de Kapso.`
    );
    if (!confirmado) return;

    setEnviando(true);
    setErrorEnvio(null);
    setResultado(null);
    try {
      const res = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruta_ids: Array.from(seleccionadas) }),
      });
      const json = (await res.json()) as { data?: ResultadoBroadcast; error?: string };
      if (json.data) {
        setResultado(json.data);
      } else {
        setErrorEnvio(json.error ?? 'Error desconocido');
      }
    } catch (err) {
      setErrorEnvio(String(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Transmisiones</h1>
      <p className="text-sm text-gray-500 mb-6">
        Selecciona una o varias rutas para enviar la plantilla &ldquo;distrisanty_oferta_diaria&rdquo; a
        todos sus clientes activos, con 3 ofertas elegidas al azar del catálogo.
      </p>

      {loading && <p className="text-gray-500">Cargando rutas...</p>}

      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium mb-1">No se pudieron cargar las rutas</p>
          <p className="text-red-500 text-sm mb-4 font-mono">{error}</p>
          <button onClick={cargar} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm">Reintentar</button>
        </div>
      )}

      {!loading && !error && rutas.length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-4xl mb-4">🗺️</p>
          <p className="text-lg font-medium text-gray-700 mb-2">No hay rutas activas</p>
          <p className="text-sm text-gray-500">Crea rutas en /dashboard/routes antes de enviar una transmisión.</p>
        </div>
      )}

      {!loading && !error && rutas.length > 0 && (
        <>
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 mb-4">
            {rutas.map((r) => (
              <label key={r.id} className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={seleccionadas.has(r.id)}
                    onChange={() => toggle(r.id)}
                    className="w-4 h-4"
                  />
                  <span className="font-medium text-gray-900">{r.nombre}</span>
                </div>
                <span className="text-sm text-gray-500">{r.total_clientes} clientes activos</span>
              </label>
            ))}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-blue-800">
              {seleccionadas.size} ruta(s) seleccionada(s) · <strong>{totalClientes}</strong> cliente(s) recibirán el mensaje
            </span>
            <button
              onClick={enviarTransmision}
              disabled={seleccionadas.size === 0 || enviando}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              {enviando ? 'Enviando…' : 'Enviar transmisión'}
            </button>
          </div>
        </>
      )}

      {errorEnvio && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">
          {errorEnvio}
        </div>
      )}

      {resultado && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
          <p className="font-semibold text-green-800 mb-2">Transmisión enviada a Kapso</p>
          <ul className="text-sm text-green-700 space-y-1">
            <li>Estado: {resultado.estado}</li>
            <li>Clientes objetivo: {resultado.total_clientes}</li>
            <li>Agregados a Kapso: {resultado.agregados}</li>
            <li>Duplicados omitidos: {resultado.duplicados}</li>
            <li>Ofertas incluidas: {resultado.ofertas.join(', ')}</li>
          </ul>
          {resultado.errores.length > 0 && (
            <div className="mt-3 pt-3 border-t border-green-200">
              <p className="text-xs font-medium text-red-700 mb-1">Errores ({resultado.errores.length}):</p>
              <ul className="text-xs text-red-600 space-y-0.5">
                {resultado.errores.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
