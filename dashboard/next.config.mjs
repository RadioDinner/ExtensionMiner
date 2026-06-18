/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Layer 2/3 reports are uploaded as PDFs through a server action; the default
    // 1 MB body cap is too small for a multi-page deep-research export.
    serverActions: { bodySizeLimit: "15mb" },
  },
};

export default nextConfig;
