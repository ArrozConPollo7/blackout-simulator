/** @type {import('next').NextConfig} */
const isStaticExport = process.env.BUILD_TARGET === "static";

const nextConfig = {
  reactStrictMode: true,
  // El Worker de Cloudflare sirve la interfaz como estáticos (`out/`), así que
  // ese build va en modo export; el servidor Node (`server.js`) sigue usando
  // el build normal con su propio servidor.
  ...(isStaticExport
    ? {
        output: "export",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
