import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Job Search Engine',
  description: 'Application pipeline, cold outreach, and UAE Emiratisation tracker',
};

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/sources', label: 'Sources' },
  { href: '/companies', label: 'Companies' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/outreach', label: 'Outreach' },
  { href: '/templates', label: 'Templates' },
  { href: '/uae', label: 'UAE Playbook' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">◆</span> Job Search Engine
          </div>
          <nav>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}>
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
