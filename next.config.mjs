/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  // The local startup script selects a verified interface address. Next.js
  // expects bare hostnames here, not origins or wildcard subnets.
  allowedDevOrigins: process.env.KIOSK_LAN_HOST
    ? [process.env.KIOSK_LAN_HOST]
    : [],
};

export default nextConfig;
