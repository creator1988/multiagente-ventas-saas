import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Pedidos' },
  { href: '/dashboard/catalog', label: 'Catálogo' },
  { href: '/dashboard/clients', label: 'Clientes' },
  { href: '/dashboard/routes', label: 'Rutas' },
  { href: '/dashboard/broadcasts', label: 'Transmisiones' },
  { href: '/dashboard/monitor', label: 'Monitor ISA' },
  { href: '/dashboard/reports', label: 'Reportes' },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
        <span className="font-bold text-gray-900 text-lg">Distrisanty</span>
        <div className="flex gap-4">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}
