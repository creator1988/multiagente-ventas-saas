'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Ruta } from '@/types';

interface ClienteFila {
  id: string;
  nombre_negocio: string | null;
  nombre_contacto: string | null;
  nombre: string;
  telefono: string | null;
  whatsapp: string;
  direccion: string | null;
  barrio: string | null;
  tipo_negocio: string | null;
  activo: boolean;
  ruta_id: string | null;
  ruta_nombre: string | null;
  ultimo_pedido?: string;
  total_pedidos?: number;
}

interface ValoresEdicion {
  nombre_negocio: string;
  telefono: string;
  whatsapp: string;
  direccion: string;
  barrio: string;
  tipo_negocio: string;
  activo: boolean;
  ruta_id: string;
}

const VALORES_VACIOS: ValoresEdicion = {
  nombre_negocio: '',
  telefono: '',
  whatsapp: '',
  direccion: '',
  barrio: '',
  tipo_negocio: '',
  activo: true,
  ruta_id: '',
};

type AccionMasiva = 'desactivar' | 'activar' | 'eliminar' | 'asignar_ruta';

const CREAR_NUEVA_RUTA = '__crear_nueva__';

export default function ClientsPage() {
  const [clientes, setClientes] = useState<ClienteFila[]>([]);
  const [rutas, setRutas] = useState<Ruta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState('');

  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [valoresEdicion, setValoresEdicion] = useState<ValoresEdicion>(VALORES_VACIOS);
  const [nuevaRutaNombre, setNuevaRutaNombre] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [confirmarEliminarId, setConfirmarEliminarId] = useState<string | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [procesandoMasivo, setProcesandoMasivo] = useState(false);
  const [confirmarEliminarMasivo, setConfirmarEliminarMasivo] = useState(false);
  const [rutaMasivaId, setRutaMasivaId] = useState('');

  async function cargar() {
    setLoading(true);
    const [resClientes, resRutas] = await Promise.all([
      fetch('/api/clients'),
      fetch('/api/routes'),
    ]);
    const jsonClientes = (await resClientes.json()) as { data: ClienteFila[] };
    const jsonRutas = (await resRutas.json()) as { data?: Ruta[] };
    setClientes(jsonClientes.data ?? []);
    setRutas(jsonRutas.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    cargar();
  }, []);

  const filtrados = clientes.filter(
    (c) =>
      c.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      c.whatsapp.includes(busqueda)
  );

  const todosSeleccionados = filtrados.length > 0 && filtrados.every((c) => seleccionados.has(c.id));

  function toggleSeleccionado(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSeleccionarTodos() {
    setSeleccionados((prev) => {
      if (todosSeleccionados) {
        const next = new Set(prev);
        filtrados.forEach((c) => next.delete(c.id));
        return next;
      }
      const next = new Set(prev);
      filtrados.forEach((c) => next.add(c.id));
      return next;
    });
  }

  function iniciarEdicion(c: ClienteFila) {
    setConfirmarEliminarId(null);
    setEditandoId(c.id);
    setNuevaRutaNombre('');
    setValoresEdicion({
      nombre_negocio: c.nombre_negocio ?? '',
      telefono: c.telefono ?? '',
      whatsapp: c.whatsapp ?? '',
      direccion: c.direccion ?? '',
      barrio: c.barrio ?? '',
      tipo_negocio: c.tipo_negocio ?? '',
      activo: c.activo,
      ruta_id: c.ruta_id ?? '',
    });
  }

  async function guardarEdicion(id: string) {
    if (valoresEdicion.ruta_id === CREAR_NUEVA_RUTA && !nuevaRutaNombre.trim()) {
      alert('Escribe un nombre para la nueva ruta.');
      return;
    }

    setGuardando(true);
    try {
      let ruta_id: string | null = valoresEdicion.ruta_id || null;

      if (valoresEdicion.ruta_id === CREAR_NUEVA_RUTA) {
        const resRuta = await fetch('/api/routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre: nuevaRutaNombre.trim(), asesor_nombre: 'Por asignar' }),
        });
        const jsonRuta = (await resRuta.json()) as { data?: Ruta; error?: string };
        if (!jsonRuta.data) {
          alert(`No se pudo crear la ruta: ${jsonRuta.error ?? 'error desconocido'}`);
          setGuardando(false);
          return;
        }
        ruta_id = jsonRuta.data.id;
        setRutas((prev) => [...prev, jsonRuta.data!].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      }

      await fetch(`/api/clients?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...valoresEdicion, ruta_id }),
      });
      setEditandoId(null);
      setNuevaRutaNombre('');
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarCliente(id: string) {
    setEliminando(true);
    try {
      const res = await fetch(`/api/clients?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setConfirmarEliminarId(null);
        setSeleccionados((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        await cargar();
      } else {
        const json = (await res.json()) as { error?: string };
        alert(`No se pudo eliminar: ${json.error ?? 'error desconocido'}`);
      }
    } finally {
      setEliminando(false);
    }
  }

  async function ejecutarAccionMasiva(accion: AccionMasiva, ruta_id?: string | null) {
    if (seleccionados.size === 0) return;
    setProcesandoMasivo(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(seleccionados), accion, ruta_id }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(`Error: ${json.error ?? 'desconocido'}`);
      }
      setSeleccionados(new Set());
      setConfirmarEliminarMasivo(false);
      setRutaMasivaId('');
      await cargar();
    } finally {
      setProcesandoMasivo(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
        <Link
          href="/dashboard/clients/import"
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          Importar Excel
        </Link>
      </div>

      <input
        type="search"
        placeholder="Buscar por nombre o WhatsApp..."
        className="w-full border border-gray-300 rounded-lg px-4 py-2 mb-4 text-sm"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
      />

      <div className="flex items-center justify-between mb-3 px-1">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={todosSeleccionados} onChange={toggleSeleccionarTodos} className="w-4 h-4" />
          Seleccionar todos ({filtrados.length})
        </label>
      </div>

      {seleccionados.size > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <span className="text-sm text-amber-800">{seleccionados.size} cliente(s) seleccionado(s)</span>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={rutaMasivaId}
                onChange={(e) => setRutaMasivaId(e.target.value)}
                className="border border-amber-300 rounded-lg px-2 py-1.5 text-sm bg-white"
              >
                <option value="">Asignar ruta…</option>
                {rutas.map((r) => (
                  <option key={r.id} value={r.id}>{r.nombre}</option>
                ))}
              </select>
              <button
                onClick={() => ejecutarAccionMasiva('asignar_ruta', rutaMasivaId)}
                disabled={procesandoMasivo || !rutaMasivaId}
                className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
              >
                Asignar ruta
              </button>
              <button
                onClick={() => ejecutarAccionMasiva('activar')}
                disabled={procesandoMasivo}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
              >
                Activar seleccionados
              </button>
              <button
                onClick={() => ejecutarAccionMasiva('desactivar')}
                disabled={procesandoMasivo}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
              >
                Desactivar seleccionados
              </button>
              <button
                onClick={() => setConfirmarEliminarMasivo(true)}
                disabled={procesandoMasivo}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
              >
                Eliminar seleccionados
              </button>
              <button
                onClick={() => setSeleccionados(new Set())}
                className="border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>

          {confirmarEliminarMasivo && (
            <div className="mt-3 pt-3 border-t border-amber-200">
              <p className="text-sm text-red-800 mb-2">
                ¿Eliminar <strong>{seleccionados.size}</strong> cliente(s)? Esta acción no se puede deshacer.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => ejecutarAccionMasiva('eliminar')}
                  disabled={procesandoMasivo}
                  className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                >
                  {procesandoMasivo ? 'Eliminando…' : 'Sí, eliminar'}
                </button>
                <button
                  onClick={() => setConfirmarEliminarMasivo(false)}
                  className="border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg text-sm"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading && <p className="text-gray-500">Cargando...</p>}

      <div className="grid gap-3">
        {filtrados.map((c) => (
          <div
            key={c.id}
            className={`rounded-lg border p-4 ${c.activo ? 'bg-white border-gray-200' : 'bg-gray-100 border-gray-200'}`}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <input
                  type="checkbox"
                  checked={seleccionados.has(c.id)}
                  onChange={() => toggleSeleccionado(c.id)}
                  className="w-4 h-4 flex-shrink-0"
                />
                <div className={`min-w-0 ${c.activo ? '' : 'opacity-60'}`}>
                  <p className="font-medium text-gray-900 truncate">{c.nombre}</p>
                  <p className="text-sm text-gray-500">{c.whatsapp}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 flex-shrink-0">
                <div className="text-right">
                  <p className="text-sm text-gray-500">Ruta</p>
                  <p className="font-medium text-gray-700">{c.ruta_nombre ?? 'Sin ruta'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500">Pedidos</p>
                  <p className="font-semibold">{c.total_pedidos ?? 0}</p>
                </div>
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${
                    c.activo ? 'bg-green-100 text-green-700' : 'bg-gray-300 text-gray-700'
                  }`}
                >
                  {c.activo ? 'Activo' : 'Inactivo'}
                </span>
                <button onClick={() => iniciarEdicion(c)} className="text-blue-600 text-sm hover:underline">
                  Editar
                </button>
                <button
                  onClick={() => {
                    setEditandoId(null);
                    setConfirmarEliminarId(c.id);
                  }}
                  className="text-red-600 text-sm hover:underline"
                >
                  Eliminar
                </button>
              </div>
            </div>

            {editandoId === c.id && (
              <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Nombre negocio</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={valoresEdicion.nombre_negocio}
                    onChange={(e) => setValoresEdicion((v) => ({ ...v, nombre_negocio: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Tipo de negocio</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={valoresEdicion.tipo_negocio}
                    onChange={(e) => setValoresEdicion((v) => ({ ...v, tipo_negocio: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Teléfono</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={valoresEdicion.telefono}
                    onChange={(e) => setValoresEdicion((v) => ({ ...v, telefono: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">WhatsApp</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={valoresEdicion.whatsapp}
                    onChange={(e) => setValoresEdicion((v) => ({ ...v, whatsapp: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Dirección</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={valoresEdicion.direccion}
                    onChange={(e) => setValoresEdicion((v) => ({ ...v, direccion: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Barrio</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={valoresEdicion.barrio}
                    onChange={(e) => setValoresEdicion((v) => ({ ...v, barrio: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Ruta</label>
                  <select
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
                    value={valoresEdicion.ruta_id}
                    onChange={(e) => setValoresEdicion((v) => ({ ...v, ruta_id: e.target.value }))}
                  >
                    <option value="">Sin ruta</option>
                    {rutas.map((r) => (
                      <option key={r.id} value={r.id}>{r.nombre}</option>
                    ))}
                    <option value={CREAR_NUEVA_RUTA}>+ Crear nueva ruta</option>
                  </select>
                  {valoresEdicion.ruta_id === CREAR_NUEVA_RUTA && (
                    <input
                      type="text"
                      placeholder="Nombre de la nueva ruta (ej: Ruta 99)"
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mt-2"
                      value={nuevaRutaNombre}
                      onChange={(e) => setNuevaRutaNombre(e.target.value)}
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={valoresEdicion.activo}
                    onChange={(e) => setValoresEdicion((v) => ({ ...v, activo: e.target.checked }))}
                  />
                  <label className="text-sm text-gray-700">Cliente activo</label>
                </div>
                <div className="col-span-2 flex items-end justify-end gap-2">
                  <button
                    onClick={() => guardarEdicion(c.id)}
                    disabled={guardando}
                    className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
                  >
                    {guardando ? 'Guardando…' : 'Guardar'}
                  </button>
                  <button
                    onClick={() => { setEditandoId(null); setNuevaRutaNombre(''); }}
                    className="border border-gray-300 text-gray-600 px-4 py-1.5 rounded-lg text-sm"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {confirmarEliminarId === c.id && (
              <div className="mt-4 -mx-4 -mb-4 px-4 py-3 bg-red-50 border-t border-red-200 rounded-b-lg">
                <p className="text-sm text-red-800 mb-3">
                  ¿Eliminar a <strong>{c.nombre}</strong>? Esta acción no se puede deshacer.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => eliminarCliente(c.id)}
                    disabled={eliminando}
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                  >
                    {eliminando ? 'Eliminando…' : 'Sí, eliminar'}
                  </button>
                  <button
                    onClick={() => setConfirmarEliminarId(null)}
                    className="border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg text-sm"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
