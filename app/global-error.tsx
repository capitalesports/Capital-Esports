"use client";

/** Last-resort error page (root layout failed), styled inline because globals may not load. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-IN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#12141f",
          color: "#f4f4f8",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: 16,
        }}
      >
        <main>
          <p style={{ fontSize: 64, fontWeight: 800, color: "#a78bfa", margin: 0 }}>500</p>
          <h1>Something went wrong</h1>
          {error.digest ? (
            <p style={{ fontSize: 12, opacity: 0.7 }}>Reference: {error.digest}</p>
          ) : null}
          <button
            onClick={() => reset()}
            style={{
              minHeight: 44,
              padding: "0 20px",
              borderRadius: 8,
              border: 0,
              background: "#a78bfa",
              color: "#12141f",
              fontWeight: 700,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
