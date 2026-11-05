export default {
  async rewrites() {
    return process.env.NODE_ENV === "development"
      ? [{ source: "/api/v1/:path*", destination: "http://127.0.0.1:4000/api/v1/:path*" }]
      : [];
  },
};
