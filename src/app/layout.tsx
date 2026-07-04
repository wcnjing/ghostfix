import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GhostFix',
  description: 'Explainable AI-visibility diagnosis and repair.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
