import { useEffect } from "react";

export default function App({ Component, pageProps }) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = "fl-verify-loader";
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.defer = true;
      s.src = "/js/verify-loader.js?v=v2025-11-10-4";
      document.head.appendChild(s);
    }
  }, []);
  return <Component {...pageProps} />;
}
