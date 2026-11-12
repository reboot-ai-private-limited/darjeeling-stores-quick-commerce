const apiOrigin = process.env.API_INTERNAL_ORIGIN ?? "http://127.0.0.1:4000";
const parsed = new URL(apiOrigin);
if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== apiOrigin) throw new Error("API_INTERNAL_ORIGIN must be an HTTP origin without a path or credentials");
export default {
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${apiOrigin}/api/v1/:path*` }];
  },
};
