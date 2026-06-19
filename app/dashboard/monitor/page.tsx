'use client';

import { useEffect, useState } from 'react';

interface ConversacionConScore {
  id: string;
  cliente_nombre: string;
  whatsapp_numero: string;
  estado: 'activa' | 'completada' | 'escalada';
  isa_score?: number;
  total_mensajes: number;
  iniciada_at: string;
  finalizada_at?: string;
}

function ScoreBadge({ score }: { score?: number }) {
  if (score === undefined || score === null) return <span className="text-gray-400 text-sm">Sin score</span>;
  const color = score >= 8 ? 'text-green-700' : score >= 5 ? 'text-yellow-700' : 'text-red-700';
  return <span className={`font-bold text-lg ${color}`}>{score}/10</span>;
}

export default function MonitorPage() {
  const [conversaciones, setConversaciones] = useState<ConversacionConScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculando, setCalculando] = useState<string | null>(null);

  async function cargar() {
    const res = await fetch('/api/monitor');
    const json = await res.json() as { data: ConversacionConScore[] };
    setConversaciones(json.data ?? []);
    setLoading(false);
  }

  useEffect(() => { cargar(); }, []);

  async function calcularScore(conversacion_id: string) {
    setCalculando(conversacion_id);
    await fetch('/api/monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversacion_id }),
    });
    setCalculando(null);
    cargar();
  }

  const promedioScore = conversaciones
    .filter((c) => c.isa_score !== null && c.isa_score !== undefined)
    .reduce((acc, c, _, arr) => acc + (c.isa_score ?? 0) / arr.length, 0);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Monitor ISA Score</h1>
        {promedioScore > 0 && (
          <div className="text-right">
            <p className="text-sm text-gray-500">Promedio general</p>
            <ScoreBadge score={Math.round(promedioScore * 10) / 10} />
          </div>
        )}
      </div>

      {loading && <p className="text-gray-500">Cargando...</p>}

      <div className="grid gap-3">
        {conversaciones.map((c) => (
          <div key={c.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">{c.cliente_nombre ?? c.whatsapp_numero}</p>
              <p className="text-sm text-gray-500">
                {c.total_mensajes} mensajes ·{' '}
                {new Date(c.iniciada_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            </div>
            <div className="flex items-center gap-6">
              <span className={`px-2 py-1 rounded-full text-xs ${
                c.estado === 'activa' ? 'bg-blue-100 text-blue-700' :
                c.estado === 'completada' ? 'bg-green-100 text-green-700' :
                'bg-red-100 text-red-700'
              }`}>
                {c.estado}
              </span>
              <ScoreBadge score={c.isa_score} />
              {c.estado !== 'activa' && !c.isa_score && (
                <button
                  onClick={() => calcularScore(c.id)}
                  disabled={calculando === c.id}
                  className="text-sm text-blue-600 hover:underline disabled:text-gray-400"
                >
                  {calculando === c.id ? 'Calculando...' : 'Calcular ISA'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
