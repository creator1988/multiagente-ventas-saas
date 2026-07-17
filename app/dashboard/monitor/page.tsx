'use client';

import { useEffect, useRef, useState } from 'react';

interface ConversacionResumen {
  id: string;
  cliente_nombre: string | null;
  whatsapp_numero: string | null;
  estado: 'activa' | 'completada' | 'escalada';
  isa_score: number | null;
  ultimo_mensaje: string | null;
  ultimo_mensaje_texto: string | null;
}

interface MensajeHilo {
  id: string;
  rol: 'cliente' | 'agente' | 'sistema';
  contenido: string;
  tipo: string;
  timestamp: string;
}

interface ConversacionDetalle extends ConversacionResumen {
  mensajes: MensajeHilo[];
}

function EstadoBadge({ estado }: { estado: string }) {
  const styles: Record<string, string> = {
    completada: 'bg-green-100 text-green-700',
    activa: 'bg-yellow-100 text-yellow-700',
    escalada: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[estado] ?? 'bg-gray-100 text-gray-700'}`}>
      {estado}
    </span>
  );
}

function Burbuja({ mensaje }: { mensaje: MensajeHilo }) {
  if (mensaje.rol === 'sistema') {
    return (
      <div className="flex justify-center mb-2">
        <span className="text-xs text-gray-400 italic bg-gray-100 rounded-full px-3 py-1">{mensaje.contenido}</span>
      </div>
    );
  }
  const esAgente = mensaje.rol === 'agente';
  return (
    <div className={`flex mb-2 ${esAgente ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm shadow-sm ${esAgente ? 'bg-green-100 text-gray-900' : 'bg-gray-200 text-gray-900'}`}>
        <p className="whitespace-pre-wrap break-words">{mensaje.contenido}</p>
        <p className="text-[10px] text-gray-400 mt-1 text-right">
          {new Date(mensaje.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
          {mensaje.tipo !== 'texto' ? ` · ${mensaje.tipo}` : ''}
        </p>
      </div>
    </div>
  );
}

export default function MonitorPage() {
  const [conversaciones, setConversaciones] = useState<ConversacionResumen[]>([]);
  const [loadingLista, setLoadingLista] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<'todas' | 'activa' | 'completada' | 'escalada'>('todas');

  const [seleccionId, setSeleccionId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<ConversacionDetalle | null>(null);
  const [loadingDetalle, setLoadingDetalle] = useState(false);

  const [mensajeTexto, setMensajeTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [escalando, setEscalando] = useState(false);

  const hiloRef = useRef<HTMLDivElement>(null);

  async function cargarLista() {
    const res = await fetch('/api/conversations?lista=true');
    const json = (await res.json()) as { data: ConversacionResumen[] };
    setConversaciones(json.data ?? []);
    setLoadingLista(false);
  }

  async function cargarDetalle(id: string) {
    setLoadingDetalle(true);
    const res = await fetch(`/api/conversations?id=${id}`);
    const json = (await res.json()) as { data: ConversacionDetalle };
    setDetalle(json.data ?? null);
    setLoadingDetalle(false);
  }

  useEffect(() => {
    cargarLista();
    const interval = setInterval(cargarLista, 8000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!seleccionId) return;
    cargarDetalle(seleccionId);
    const interval = setInterval(() => cargarDetalle(seleccionId), 5000);
    return () => clearInterval(interval);
  }, [seleccionId]);

  useEffect(() => {
    hiloRef.current?.scrollTo({ top: hiloRef.current.scrollHeight });
  }, [detalle?.mensajes.length]);

  async function enviarComoAgente() {
    if (!seleccionId || !mensajeTexto.trim()) return;
    setEnviando(true);
    const res = await fetch(`/api/conversations?id=${seleccionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensaje: mensajeTexto.trim() }),
    });
    setEnviando(false);
    if (res.ok) {
      setMensajeTexto('');
      cargarDetalle(seleccionId);
      cargarLista();
    } else {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      alert(json.error ?? 'No se pudo enviar el mensaje');
    }
  }

  async function marcarEscalada() {
    if (!seleccionId) return;
    if (!confirm('¿Marcar esta conversación como escalada y notificar al asesor?')) return;
    setEscalando(true);
    await fetch(`/api/conversations?id=${seleccionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'escalada', motivo: 'Escalada manual desde el monitor' }),
    });
    setEscalando(false);
    cargarDetalle(seleccionId);
    cargarLista();
  }

  const filtradas = conversaciones.filter((c) => {
    const coincideBusqueda =
      (c.cliente_nombre ?? '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (c.whatsapp_numero ?? '').includes(busqueda);
    const coincideEstado = filtroEstado === 'todas' || c.estado === filtroEstado;
    return coincideBusqueda && coincideEstado;
  });

  return (
    <div className="flex h-[calc(100vh-65px)]">
      {/* Lista de conversaciones */}
      <div className="w-full md:w-96 border-r border-gray-200 flex flex-col bg-white shrink-0">
        <div className="p-4 border-b border-gray-200 space-y-2">
          <h1 className="text-lg font-bold text-gray-900">Conversaciones</h1>
          <input
            type="text"
            placeholder="Buscar por nombre o WhatsApp..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
          />
          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value as typeof filtroEstado)}
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
          >
            <option value="todas">Todos los estados</option>
            <option value="activa">Activa</option>
            <option value="completada">Completada</option>
            <option value="escalada">Escalada</option>
          </select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingLista && <p className="p-4 text-sm text-gray-500">Cargando...</p>}
          {!loadingLista && filtradas.length === 0 && (
            <p className="p-4 text-sm text-gray-500">No hay conversaciones.</p>
          )}
          {filtradas.map((c) => (
            <button
              key={c.id}
              onClick={() => setSeleccionId(c.id)}
              className={`w-full text-left p-4 border-b border-gray-100 hover:bg-gray-50 ${
                seleccionId === c.id ? 'bg-blue-50' : ''
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <p className="font-medium text-gray-900 truncate">{c.cliente_nombre ?? c.whatsapp_numero}</p>
                <span className="text-[11px] text-gray-400 shrink-0">
                  {c.ultimo_mensaje
                    ? new Date(c.ultimo_mensaje).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
                    : ''}
                </span>
              </div>
              <p className="text-xs text-gray-500 truncate mt-0.5">{c.whatsapp_numero}</p>
              <p className="text-sm text-gray-600 truncate mt-1">{c.ultimo_mensaje_texto ?? 'Sin mensajes'}</p>
              <div className="flex items-center gap-2 mt-2">
                <EstadoBadge estado={c.estado} />
                {c.isa_score !== null && c.isa_score !== undefined && (
                  <span className="text-xs text-gray-500">ISA {c.isa_score}/10</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detalle de conversación */}
      <div className="flex-1 flex flex-col bg-gray-50">
        {!seleccionId && (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Selecciona una conversación para ver el detalle
          </div>
        )}

        {seleccionId && (
          <>
            <div className="p-4 border-b border-gray-200 bg-white flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{detalle?.cliente_nombre ?? detalle?.whatsapp_numero ?? '...'}</p>
                <p className="text-xs text-gray-500">{detalle?.whatsapp_numero}</p>
              </div>
              <div className="flex items-center gap-3">
                {detalle && <EstadoBadge estado={detalle.estado} />}
                {detalle?.isa_score !== null && detalle?.isa_score !== undefined && (
                  <span className="text-sm text-gray-500">ISA {detalle?.isa_score}/10</span>
                )}
                <button
                  onClick={marcarEscalada}
                  disabled={escalando || detalle?.estado === 'escalada'}
                  className="text-sm text-red-600 border border-red-300 rounded-md px-3 py-1.5 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {escalando ? 'Escalando...' : 'Marcar como escalada'}
                </button>
              </div>
            </div>

            <div ref={hiloRef} className="flex-1 overflow-y-auto p-4">
              {loadingDetalle && !detalle && <p className="text-sm text-gray-500">Cargando mensajes...</p>}
              {detalle?.mensajes.map((m) => (
                <Burbuja key={m.id} mensaje={m} />
              ))}
            </div>

            <div className="p-4 border-t border-gray-200 bg-white flex gap-2">
              <input
                type="text"
                value={mensajeTexto}
                onChange={(e) => setMensajeTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') enviarComoAgente();
                }}
                placeholder="Escribe un mensaje como agente..."
                className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
              <button
                onClick={enviarComoAgente}
                disabled={enviando || !mensajeTexto.trim()}
                className="bg-green-600 text-white text-sm px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {enviando ? 'Enviando...' : 'Enviar como agente'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
