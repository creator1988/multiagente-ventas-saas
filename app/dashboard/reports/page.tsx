'use client';

import { useEffect, useState } from 'react';

interface ReporteData {
  total_pedidos: number;
  revenue_total: number;
  ticket_promedio: number;
  pedidos_por_estado: Array<{ estado: string; total: number; revenue: number }>;
  top_productos: Array<{ nombre: string; unidades: number; revenue: number }>;
  analisis_escalabilidad?: {
    resumen: string;
    alertas: string[];
    oportunidades: string[];
  };
}

export default function ReportsPage() {
  const [reporte, setReporte] = useState<ReporteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState<'7d' | '30d' | '90d'>('7d');

  useEffect(() => {
    async function cargar() {
      setLoading(true);
      const [pedidosRes, escalRes] = await Promise.all([
        fetch(`/api/orders`),
        fetch(`/api/escalability`),
      ]);
      const pedidosJson = await pedidosRes.json() as { data: Array<{ estado: string; total: number }> };
      const escalJson = await escalRes.json() as { data: Array<{ metricas: unknown; analisis: ReporteData['analisis_escalabilidad'] }> };

      const pedidos = pedidosJson.data ?? [];
      const revenue = pedidos.reduce((acc, p) => acc + Number(p.total), 0);

      const porEstado: Record<string, { total: number; revenue: number }> = {};
      pedidos.forEach((p) => {
        if (!porEstado[p.estado]) porEstado[p.estado] = { total: 0, revenue: 0 };
        porEstado[p.estado].total += 1;
        porEstado[p.estado].revenue += Number(p.total);
      });

      setReporte({
        total_pedidos: pedidos.length,
        revenue_total: revenue,
        ticket_promedio: pedidos.length ? revenue / pedidos.length : 0,
        pedidos_por_estado: Object.entries(porEstado).map(([estado, v]) => ({ estado, ...v })),
        top_productos: [],
        analisis_escalabilidad: escalJson.data?.[0]?.analisis,
      });
      setLoading(false);
    }
    cargar();
  }, [periodo]);

  if (loading) return <div className="p-6 text-gray-500">Cargando...</div>;
  if (!reporte) return null;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reportes</h1>
        <div className="flex gap-2">
          {(['7d', '30d', '90d'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              className={`px-3 py-1.5 rounded text-sm ${periodo === p ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700'}`}
            >
              {p === '7d' ? '7 días' : p === '30d' ? '30 días' : '90 días'}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">Total pedidos</p>
          <p className="text-3xl font-bold text-gray-900">{reporte.total_pedidos}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">Revenue</p>
          <p className="text-3xl font-bold text-green-700">${reporte.revenue_total.toLocaleString('es-CO')}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">Ticket promedio</p>
          <p className="text-3xl font-bold text-gray-900">${Math.round(reporte.ticket_promedio).toLocaleString('es-CO')}</p>
        </div>
      </div>

      {/* Pedidos por estado */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
        <h2 className="font-semibold text-gray-900 mb-4">Pedidos por estado</h2>
        <div className="space-y-2">
          {reporte.pedidos_por_estado.map((e) => (
            <div key={e.estado} className="flex justify-between items-center">
              <span className="text-sm capitalize text-gray-700">{e.estado}</span>
              <div className="flex gap-4 text-sm">
                <span className="text-gray-600">{e.total} pedidos</span>
                <span className="font-semibold text-green-700">${Number(e.revenue).toLocaleString('es-CO')}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Análisis IA */}
      {reporte.analisis_escalabilidad && (
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-5">
          <h2 className="font-semibold text-blue-900 mb-3">Análisis IA (último semanal)</h2>
          <p className="text-sm text-blue-800 mb-4">{reporte.analisis_escalabilidad.resumen}</p>
          {reporte.analisis_escalabilidad.alertas?.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-red-700 mb-1">ALERTAS</p>
              <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
                {reporte.analisis_escalabilidad.alertas.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
          {reporte.analisis_escalabilidad.oportunidades?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-green-700 mb-1">OPORTUNIDADES</p>
              <ul className="list-disc list-inside text-sm text-green-700 space-y-1">
                {reporte.analisis_escalabilidad.oportunidades.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
