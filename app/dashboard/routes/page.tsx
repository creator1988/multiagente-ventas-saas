'use client';

import { useEffect, useState } from 'react';
import type { RutaConClientes } from '@/types';

interface ValoresRuta {
  nombre: string;
  asesor_nombre: string;
  asesor_telefono: string;
  asesor_whatsapp: string;
  dias_visita: string;
  zona_cobertura: string;
}

const VALORES_VACIOS: ValoresRuta = {
  nombre: '',
  asesor_nombre: '',
  asesor_telefono: '',
  asesor_whatsapp: '',
  dias_visita: '',
  zona_cobertura: '',
};

export default function RoutesPage() {
  const [rutas, setRutas] = useState<RutaConClientes[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [valores, setValores] = useState<ValoresRuta>(VALORES_VACIOS);
  const [guardando, setGuardando] = useState(false);
  const [confirmarEliminarId, setConfirmarEliminarId] = useState<string | null>(null);
  const [eliminando, setEliminando] = useState(false);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/routes');
      const json = (await res.json()) as { data?: RutaConClientes[]; error?: string };
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

  function abrirNuevaRuta() {
    setEditandoId(null);
    setValores(VALORES_VACIOS);
    setMostrarForm(true);
  }

  function iniciarEdicion(r: RutaConClientes) {
    setMostrarForm(false);
    setConfirmarEliminarId(null);
    setEditandoId(r.id);
    setValores({
      nombre: r.nombre ?? '',
      asesor_nombre: r.asesor_nombre ?? '',
      asesor_telefono: r.asesor_telefono ?? '',
      asesor_whatsapp: r.asesor_whatsapp ?? '',
      dias_visita: r.dias_visita ?? '',
      zona_cobertura: r.zona_cobertura ?? '',
    });
  }

  async function crearRuta() {
    if (!valores.nombre.trim()) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(valores),
      });
      if (res.ok) {
        setMostrarForm(false);
        setValores(VALORES_VACIOS);
        await cargar();
      } else {
        const json = (await res.json()) as { error?: string };
        alert(`No se pudo crear la ruta: ${json.error ?? 'error desconocido'}`);
      }
    } finally {
      setGuardando(false);
    }
  }

  async function guardarEdicion(id: string) {
    setGuardando(true);
    try {
      await fetch(`/api/routes?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(valores),
      });
      setEditandoId(null);
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarRuta(id: string) {
    setEliminando(true);
    try {
      const res = await fetch(`/api/routes?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setConfirmarEliminarId(null);
        await cargar();
      } else {
        const json = (await res.json()) as { error?: string };
        alert(`No se pudo eliminar: ${json.error ?? 'error desconocido'}`);
      }
    } finally {
      setEliminando(false);
    }
  }

  function FormularioRuta({ onGuardar, onCancelar }: { onGuardar: () => void; onCancelar: () => void }) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Nombre (ej: Ruta 44)</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              value={valores.nombre}
              onChange={(e) => setValores((v) => ({ ...v, nombre: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Nombre del asesor</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              value={valores.asesor_nombre}
              onChange={(e) => setValores((v) => ({ ...v, asesor_nombre: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Teléfono del asesor</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              value={valores.asesor_telefono}
              onChange={(e) => setValores((v) => ({ ...v, asesor_telefono: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">WhatsApp del asesor</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              value={valores.asesor_whatsapp}
              onChange={(e) => setValores((v) => ({ ...v, asesor_whatsapp: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Días de visita</label>
            <input
              type="text"
              placeholder="Ej: Lunes y jueves"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              value={valores.dias_visita}
              onChange={(e) => setValores((v) => ({ ...v, dias_visita: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Zona de cobertura</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              value={valores.zona_cobertura}
              onChange={(e) => setValores((v) => ({ ...v, zona_cobertura: e.target.value }))}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onGuardar}
            disabled={guardando || !valores.nombre.trim()}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
          <button onClick={onCancelar} className="border border-gray-300 text-gray-600 px-4 py-1.5 rounded-lg text-sm">
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Rutas</h1>
        <button
          onClick={abrirNuevaRuta}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          Nueva ruta
        </button>
      </div>

      {mostrarForm && (
        <FormularioRuta onGuardar={crearRuta} onCancelar={() => setMostrarForm(false)} />
      )}

      {loading && <p className="text-gray-500">Cargando...</p>}

      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium mb-1">No se pudieron cargar las rutas</p>
          <p className="text-red-500 text-sm mb-4 font-mono">{error}</p>
          <button onClick={cargar} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm">Reintentar</button>
        </div>
      )}

      {!loading && !error && rutas.length === 0 && !mostrarForm && (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-4xl mb-4">🗺️</p>
          <p className="text-lg font-medium text-gray-700 mb-2">No hay rutas creadas</p>
          <p className="text-sm text-gray-500 mb-6">Crea una ruta o impórtalas al cargar el Excel de clientes.</p>
          <button onClick={abrirNuevaRuta} className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium">
            Nueva ruta
          </button>
        </div>
      )}

      {!loading && !error && rutas.length > 0 && (
        <div className="grid gap-3">
          {rutas.map((r) => (
            <div key={r.id} className={`rounded-lg border p-4 ${r.activo ? 'bg-white border-gray-200' : 'bg-gray-100 border-gray-200'}`}>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">{r.nombre}</p>
                    <span className="text-xs text-gray-400">({r.total_clientes} clientes)</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {r.asesor_nombre ?? 'Sin asesor asignado'}
                    {r.asesor_whatsapp ? ` · ${r.asesor_whatsapp}` : ''}
                    {r.dias_visita ? ` · ${r.dias_visita}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${r.activo ? 'bg-green-100 text-green-700' : 'bg-gray-300 text-gray-700'}`}>
                    {r.activo ? 'Activa' : 'Inactiva'}
                  </span>
                  <button onClick={() => iniciarEdicion(r)} className="text-blue-600 text-sm hover:underline">Editar</button>
                  <button
                    onClick={() => { setEditandoId(null); setConfirmarEliminarId(r.id); }}
                    className="text-red-600 text-sm hover:underline"
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              {editandoId === r.id && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <FormularioRuta onGuardar={() => guardarEdicion(r.id)} onCancelar={() => setEditandoId(null)} />
                </div>
              )}

              {confirmarEliminarId === r.id && (
                <div className="mt-4 -mx-4 -mb-4 px-4 py-3 bg-red-50 border-t border-red-200 rounded-b-lg">
                  <p className="text-sm text-red-800 mb-3">
                    ¿Eliminar la ruta <strong>{r.nombre}</strong>? Esta acción no se puede deshacer.
                    {r.total_clientes > 0 && ' Tiene clientes asignados — probablemente falle hasta que los reasignes.'}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => eliminarRuta(r.id)}
                      disabled={eliminando}
                      className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                    >
                      {eliminando ? 'Eliminando…' : 'Sí, eliminar'}
                    </button>
                    <button onClick={() => setConfirmarEliminarId(null)} className="border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg text-sm">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
