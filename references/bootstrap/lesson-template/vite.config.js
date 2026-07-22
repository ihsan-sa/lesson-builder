import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getProxyPort() {
  try {
    const portFile = path.join("server", ".proxy-port");
    return parseInt(fs.readFileSync(portFile, "utf8").trim(), 10) || 3001;
  } catch (_) {
    return 3001;
  }
}

export default defineConfig({
  plugins: [react()],
  // Load .env.local from the WORKSPACE ROOT so one key file (VITE_DESMOS_KEY)
  // serves every lesson. Vite does NOT walk upward on its own — without this,
  // a root .env.local is silently ignored and Desmos reports a missing key.
  envDir: path.resolve(__dirname, "../../.."),
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "../../../_lesson-core"),
    },
  },
  server: {
    fs: { allow: ["..", "../..", "../../..", "../../../.."] },
    proxy: {
      "/chat": `http://localhost:${getProxyPort()}`,
      "/upload": `http://localhost:${getProxyPort()}`,
      "/session": `http://localhost:${getProxyPort()}`,
      "/sessions": `http://localhost:${getProxyPort()}`,
    },
  },
});
