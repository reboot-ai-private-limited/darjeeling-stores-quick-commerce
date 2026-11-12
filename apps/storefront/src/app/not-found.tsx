import Link from "next/link";
import { Icon } from "../components/ui/Icon";

export default function NotFound() {
  return (
    <main
      className="page-container"
      style={{
        textAlign: "center",
        padding: "80px 16px",
        maxWidth: 520,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "var(--amber-soft)",
          color: "var(--amber)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 20,
        }}
      >
        <Icon name="search" size={36} color="var(--amber)" />
      </div>

      <h1 className="title" style={{ fontSize: 24, marginBottom: 8, color: "var(--maroon)" }}>
        Page Not Found
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 15, marginBottom: 24, lineHeight: 1.5 }}>
        The page you are looking for doesn't exist or has been moved. Explore our fresh mountain produce and daily essentials on the home page.
      </p>

      <Link href="/" className="btn btn-primary" style={{ display: "inline-flex", padding: "12px 28px", textDecoration: "none" }}>
        Back to Home
      </Link>
    </main>
  );
}
