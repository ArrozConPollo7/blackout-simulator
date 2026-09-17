import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CrtProvider } from "@/lib/crtContext";

export const metadata: Metadata = {
  title: "BLACKOUT: GRID COLLAPSE // Terminal CRT-Punk",
  description:
    "Simulador multijugador asimétrico de gestión de crisis eléctrica en tiempo real: proyector para el salón y mando por mesa.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#12121d",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body className="bg-surface font-mono text-on-surface min-h-screen relative selection:bg-primary-container selection:text-on-primary-container">
        <CrtProvider>{children}</CrtProvider>
      </body>
    </html>
  );
}
