import type { Metadata } from 'next';
import './globals.css';
import DemoNav from '@/components/DemoNav';

export const metadata: Metadata = {
  title: 'Energ�a en Crisis � SCADA Telemetry & Grid Resilience',
  description: 'Simulador y centro de telemetr�a de resiliencia energ�tica para control de red y contingencias.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-bg-primary text-text-primary antialiased min-h-screen selection:bg-primary-container selection:text-on-primary-container">
        {children}
        <DemoNav />
      </body>
    </html>
  );
}
