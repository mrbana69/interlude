/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const serverUrl = process.env.SERVER_URL || 'http://localhost:2007';
    return [
      {
        source: '/api/:path*',
        destination: `${serverUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
