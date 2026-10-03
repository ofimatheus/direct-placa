import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Binário nativo (Skia) usado pelo renderer: não deve ser empacotado pelo bundler.
  serverExternalPackages: ["@napi-rs/canvas"],
  // As fontes do renderer são lidas do disco no servidor; garante que entrem no bundle da função na Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["./public/fonts/**"],
  },
  poweredByHeader: false,
};

export default nextConfig;
