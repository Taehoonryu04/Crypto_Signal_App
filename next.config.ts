import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Supabase host is env-driven, so the CSP is assembled at build time.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseWs = supabaseUrl.replace(/^https:/, "wss:");

const connectSrc = [
  "'self'",
  supabaseUrl,
  supabaseWs,
  "https://api.binance.com",
  "wss://stream.binance.com",
  "https://api.bybit.com",
  "wss://stream.bybit.com",
  "https://api.exchange.coinbase.com",
  "wss://ws-feed.exchange.coinbase.com",
  "https://api.upbit.com",
  "wss://api.upbit.com",
  // Next dev server HMR socket
  ...(isDev ? ["ws://localhost:*", "http://localhost:*"] : []),
].filter(Boolean);

const csp = [
  "default-src 'self'",
  // Next injects inline bootstrap/hydration scripts. Nonces would require
  // rewriting every response in middleware; 'unsafe-eval' is dev-only (React Refresh).
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSrc.join(" ")}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
