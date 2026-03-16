import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AFSM — Autonomous Flight Safety Monitor',
  description: 'Autonomous flight safety monitoring console for delivery drones.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
