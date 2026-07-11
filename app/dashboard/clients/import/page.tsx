'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import type { ClienteImportRow, ResultadoImportClientes, AsignacionRutaImport, Ruta } from '@/types';
import { toTitulo } from '@/lib/nombre-limpio';

// ---------------------------------------------------------------------------
// Parseo de filas
// ---------------------------------------------------------------------------

interface FilaClienteRaw {
  [key: string]: unknown;
}

const REGEX_RUTA_NOMBRE = /^(\d+)\s*[-]?\s*(.+)/;

function obtenerCampo(fila: FilaClienteRaw, nombreColumna: string): string {
  const key = Object.keys(fila).find((k) => k.trim().toLowerCase() === nombreColumna);
  return key ? String(fila[key] ?? '').trim() : '';
}

function formatearWhatsapp(telefono: string): { whatsapp: string | null; motivo?: string } {
  const soloDigitos = telefono.replace(/\D/g, '');

  if (soloDigitos.length === 10) {
    return { whatsapp: `57${soloDigitos}` };
  }
  if (soloDigitos.length === 12 && soloDigitos.startsWith('57')) {
    return { whatsapp: soloDigitos };
  }
  return { whatsapp: null, motivo: `Teléfono inválido: "${telefono || '(vacío)'}"` };
}

function parsearFila(fila: FilaClienteRaw, index: number): ClienteImportRow {
  const clienteRaw = obtenerCampo(fila, 'cliente');
  const telefonoRaw = obtenerCampo(fila, 'telefono');

  const match = clienteRaw.match(REGEX_RUTA_NOMBRE);
  const ruta_codigo = match ? match[1] : '';
  const nombreCrudo = match ? match[2] : clienteRaw;
  const nombre_limpio = toTitulo(nombreCrudo.trim());

  const { whatsapp, motivo } = formatearWhatsapp(telefonoRaw);

  return {
    fila_numero: index + 2,
    nombre_original: clienteRaw,
    nombre_limpio,
    ruta_codigo,
    telefono_original: telefonoRaw,
    whatsapp,
    valido: whatsapp !== null && nombre_limpio.length > 0,
    motivo_invalido: whatsapp === null ? motivo : nombre_limpio.length === 0 ? 'Nombre vacío' : undefined,
  };
}

function parsearExcel(buffer: ArrayBuffer): ClienteImportRow[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json<FilaClienteRaw>(ws);
  return filas.map(parsearFila).filter((r) => r.nombre_original || r.telefono_original);
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

type Paso = 'subir' | 'rutas' | 'preview' | 'resultado';
type EstadoPreview = 'nuevo' | 'existente' | 'invalido';

const CREAR_NUEVA = '__crear_nueva__';

function EstadoBadge({ estado }: { estado: EstadoPreview }) {
  const estilos: Record<EstadoPreview, string> = {
    nuevo: 'bg-green-100 text-green-700',
    existente: 'bg-blue-100 text-blue-700',
    invalido: 'bg-red-100 text-red-700',
  };
  const etiquetas: Record<EstadoPreview, string> = {
    nuevo: 'Nuevo',
    existente: 'Existente',
    invalido: 'Inválido',
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${estilos[estado]}`}>{etiquetas[estado]}</span>;
}

export default function ImportarClientesPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [paso, setPaso] = useState<Paso>('subir');
  const [archivoNombre, setArchivoNombre] = useState('');
  const [clientes, setClientes] = useState<ClienteImportRow[]>([]);
  const [existentes, setExistentes] = useState<Set<string>>(new Set());
  const [rutasExistentes, setRutasExistentes] = useState<Ruta[]>([]);
  const [asignaciones, setAsignaciones] = useState<Record<string, AsignacionRutaImport>>({});
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportClientes | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);

  const codigosDetectados = useMemo(() => {
    const set = new Set(clientes.map((c) => c.ruta_codigo).filter(Boolean));
    return Array.from(set).sort();
  }, [clientes]);

  const procesarArchivo = useCallback(async (file: File) => {
    if (!file.name.endsWith('.xlsx')) {
      alert('Solo se aceptan archivos .xlsx');
      return;
    }
    setArchivoNombre(file.name);
    setCargando(true);
    setErrorArchivo(null);
    try {
      const [buffer, existentesRes, rutasRes] = await Promise.all([
        file.arrayBuffer(),
        fetch('/api/clients/import').then((r) => r.json() as Promise<{ data?: string[]; error?: string }>),
        fetch('/api/routes').then((r) => r.json() as Promise<{ data?: Ruta[]; error?: string }>),
      ]);
      const filas = parsearExcel(buffer);
      if (filas.length === 0) {
        setErrorArchivo('No se encontraron filas con datos en las columnas "cliente" y "telefono".');
        setCargando(false);
        return;
      }

      const rutas = rutasRes.data ?? [];
      setClientes(filas);
      setExistentes(new Set(existentesRes.data ?? []));
      setRutasExistentes(rutas);

      // Prellenar una decisión por cada código de ruta detectado: si existe
      // una ruta con nombre exacto "Ruta {codigo}" se preselecciona (el
      // usuario la ve y puede cambiarla); si no, se sugiere crear una nueva.
      const codigos = Array.from(new Set(filas.map((c) => c.ruta_codigo).filter(Boolean)));
      const iniciales: Record<string, AsignacionRutaImport> = {};
      for (const codigo of codigos) {
        const nombreSugerido = `Ruta ${codigo}`;
        const coincidencia = rutas.find((r) => r.nombre === nombreSugerido);
        iniciales[codigo] = coincidencia
          ? { ruta_codigo: codigo, ruta_id: coincidencia.id, crear_nueva: false, nombre_sugerido: nombreSugerido }
          : { ruta_codigo: codigo, ruta_id: null, crear_nueva: true, nombre_sugerido: nombreSugerido };
      }
      setAsignaciones(iniciales);

      setPaso(codigos.length > 0 ? 'rutas' : 'preview');
    } catch (err) {
      setErrorArchivo(`Error leyendo el archivo: ${String(err)}`);
    } finally {
      setCargando(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void procesarArchivo(file);
    },
    [procesarArchivo]
  );

  function actualizarAsignacion(codigo: string, valorSelect: string) {
    setAsignaciones((prev) => {
      const nombreSugerido = `Ruta ${codigo}`;
      if (valorSelect === CREAR_NUEVA) {
        return { ...prev, [codigo]: { ruta_codigo: codigo, ruta_id: null, crear_nueva: true, nombre_sugerido: nombreSugerido } };
      }
      return { ...prev, [codigo]: { ruta_codigo: codigo, ruta_id: valorSelect, crear_nueva: false, nombre_sugerido: nombreSugerido } };
    });
  }

  function nombreRutaResuelta(codigo: string): string {
    if (!codigo) return 'Sin ruta';
    const asignacion = asignaciones[codigo];
    if (!asignacion) return `Ruta ${codigo}`;
    if (asignacion.crear_nueva) return `Nueva: ${asignacion.nombre_sugerido}`;
    const ruta = rutasExistentes.find((r) => r.id === asignacion.ruta_id);
    return ruta ? ruta.nombre : `Ruta ${codigo}`;
  }

  const estadoDeFila = (c: ClienteImportRow): EstadoPreview => {
    if (!c.valido || !c.whatsapp) return 'invalido';
    return existentes.has(c.whatsapp) ? 'existente' : 'nuevo';
  };

  const conteo = clientes.reduce(
    (acc, c) => {
      const e = estadoDeFila(c);
      acc[e]++;
      return acc;
    },
    { nuevo: 0, existente: 0, invalido: 0 } as Record<EstadoPreview, number>
  );

  const importar = async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/clients/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientes, asignaciones: Object.values(asignaciones) }),
      });
      const json = (await res.json()) as { data?: ResultadoImportClientes; error?: string };
      if (json.data) {
        setResultado(json.data);
        setPaso('resultado');
      } else {
        alert(`Error: ${json.error ?? 'desconocido'}`);
      }
    } catch (err) {
      alert(`Error de red: ${String(err)}`);
    } finally {
      setCargando(false);
    }
  };

  return (
    <>
      {/* ---- Paso subir: Drop zone ---- */}
      {paso === 'subir' && (
        <div key="paso-subir" className="p-6 max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Link href="/dashboard/clients" className="text-gray-400 hover:text-gray-600 text-sm">
              ← Clientes
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Importar clientes Excel</h1>
          </div>

          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => !cargando && inputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-16 text-center transition-colors ${
              cargando
                ? 'border-blue-400 bg-blue-50 cursor-wait'
                : dragOver
                ? 'border-blue-500 bg-blue-50 cursor-pointer'
                : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50 cursor-pointer'
            }`}
          >
            {cargando ? (
              <>
                <div className="inline-block w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-gray-600 font-medium">Procesando Excel…</p>
              </>
            ) : (
              <>
                <div className="text-5xl mb-4">👥</div>
                <p className="text-lg font-medium text-gray-700 mb-1">Arrastra tu archivo Excel aquí</p>
                <p className="text-sm text-gray-500 mb-4">o haz clic para seleccionar</p>
                <span className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  Seleccionar archivo .xlsx
                </span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) void procesarArchivo(e.target.files[0]); }}
            />
          </div>

          {errorArchivo && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {errorArchivo}
            </div>
          )}

          <div className="mt-6 bg-gray-50 rounded-lg p-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Columnas requeridas en el Excel:</p>
            <div className="flex flex-wrap gap-2">
              {['cliente', 'telefono'].map((col) => (
                <span key={col} className="bg-white border border-gray-200 text-gray-700 text-xs px-2 py-1 rounded font-mono">
                  {col}
                </span>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-3">
              La columna <strong>cliente</strong> debe traer el código de ruta seguido del nombre, ej:
              &ldquo;44 GLORIA GUTIERREZ&rdquo;. El teléfono debe tener 10 dígitos (o 12 si ya incluye el
              indicativo 57).
            </p>
          </div>
        </div>
      )}

      {/* ---- Paso rutas: asignar cada código detectado a una ruta del sistema ---- */}
      {paso === 'rutas' && (
        <div key="paso-rutas" className="p-6 max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Asignar rutas</h1>
              <p className="text-sm text-gray-500 mt-1">
                Confirma a qué ruta del sistema corresponde cada código detectado en el Excel.
              </p>
            </div>
            <button
              onClick={() => setPaso('subir')}
              className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm"
            >
              Cambiar archivo
            </button>
          </div>

          <div className="space-y-4 mb-6">
            {codigosDetectados.map((codigo) => {
              const cantidad = clientes.filter((c) => c.ruta_codigo === codigo).length;
              const asignacion = asignaciones[codigo];
              const valorSelect = asignacion?.crear_nueva ? CREAR_NUEVA : asignacion?.ruta_id ?? '';

              return (
                <div key={codigo} className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-sm text-gray-800 mb-2">
                    Se detectaron clientes de la ruta <strong>{codigo}</strong> ({cantidad} clientes).
                    ¿A qué ruta del sistema corresponde?
                  </p>
                  <select
                    value={valorSelect}
                    onChange={(e) => actualizarAsignacion(codigo, e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {rutasExistentes.map((r) => (
                      <option key={r.id} value={r.id}>{r.nombre}</option>
                    ))}
                    <option value={CREAR_NUEVA}>+ Crear nueva ruta &ldquo;Ruta {codigo}&rdquo;</option>
                  </select>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => setPaso('preview')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Revisar e importar →
          </button>
        </div>
      )}

      {/* ---- Paso preview: Vista previa ---- */}
      {paso === 'preview' && (
        <div key="paso-preview" className="p-6 max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Vista previa — {archivoNombre}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {clientes.length} filas ·{' '}
                <span className="text-green-600 font-medium">{conteo.nuevo} nuevos</span> ·{' '}
                <span className="text-blue-600 font-medium">{conteo.existente} existentes</span> ·{' '}
                <span className="text-red-600 font-medium">{conteo.invalido} inválidos</span>
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setPaso(codigosDetectados.length > 0 ? 'rutas' : 'subir')}
                className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm"
              >
                ← Volver
              </button>
              <button
                onClick={importar}
                disabled={cargando || conteo.nuevo + conteo.existente === 0}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
              >
                {cargando ? (
                  <>
                    <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Importando…
                  </>
                ) : (
                  'Importar clientes'
                )}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left font-medium text-gray-600">Fila</th>
                  <th className="px-3 py-3 text-left font-medium text-gray-600">Nombre</th>
                  <th className="px-3 py-3 text-left font-medium text-gray-600">Teléfono</th>
                  <th className="px-3 py-3 text-left font-medium text-gray-600">Ruta</th>
                  <th className="px-3 py-3 text-left font-medium text-gray-600">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clientes.map((c) => {
                  const estado = estadoDeFila(c);
                  return (
                    <tr key={c.fila_numero} className={estado === 'invalido' ? 'bg-red-50/40' : 'hover:bg-gray-50'}>
                      <td className="px-3 py-2 text-gray-400 text-xs">{c.fila_numero}</td>
                      <td className="px-3 py-2 text-gray-900">
                        {c.nombre_limpio || <span className="text-red-500 text-xs">{c.motivo_invalido}</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-600">
                        {c.whatsapp ?? <span className="text-red-500">{c.motivo_invalido}</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{nombreRutaResuelta(c.ruta_codigo)}</td>
                      <td className="px-3 py-2">
                        <EstadoBadge estado={estado} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- Paso resultado ---- */}
      {paso === 'resultado' && resultado && (
        <div key="paso-resultado" className="p-6 max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">✅</div>
            <h1 className="text-2xl font-bold text-gray-900">¡Importación completada!</h1>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
              <p className="text-3xl font-bold text-green-700">{resultado.nuevos}</p>
              <p className="text-sm text-green-600 mt-1">Clientes nuevos</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-center">
              <p className="text-3xl font-bold text-blue-700">{resultado.actualizados}</p>
              <p className="text-sm text-blue-600 mt-1">Actualizados</p>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 text-center">
              <p className="text-3xl font-bold text-purple-700">{resultado.rutas_creadas}</p>
              <p className="text-sm text-purple-600 mt-1">Rutas nuevas creadas</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-center">
              <p className="text-3xl font-bold text-red-700">{resultado.invalidos}</p>
              <p className="text-sm text-red-600 mt-1">Inválidos</p>
            </div>
          </div>

          {resultado.errores.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
              <p className="text-sm font-medium text-red-700 mb-2">
                Errores ({resultado.errores.length}):
              </p>
              <ul className="space-y-1">
                {resultado.errores.map((e, i) => (
                  <li key={i} className="text-xs text-red-600">• {e}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-3">
            <Link
              href="/dashboard/clients"
              className="flex-1 bg-blue-600 text-white px-4 py-3 rounded-lg text-sm font-medium text-center"
            >
              Ver clientes
            </Link>
            <button
              onClick={() => {
                setPaso('subir');
                setResultado(null);
                setClientes([]);
                setExistentes(new Set());
                setRutasExistentes([]);
                setAsignaciones({});
                setArchivoNombre('');
              }}
              className="flex-1 border border-gray-300 text-gray-600 px-4 py-3 rounded-lg text-sm"
            >
              Importar otro archivo
            </button>
          </div>
        </div>
      )}
    </>
  );
}
