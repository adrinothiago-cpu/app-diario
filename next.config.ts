import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Export 100% estático: o app roda sem servidor Next (PWA no desktop,
  // WebView do Capacitor no Android). Nada aqui pode depender de SSR/ISR/API routes.
  output: "export",
  // O otimizador de imagens do Next exige servidor; em export estático é proibido.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
