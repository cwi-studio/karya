// Karya Go — served by the web image under /go/ (see apps/web/Dockerfile.web).
// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from "vite";

const api = process.env.KARYA_API ?? "http://localhost:8000"; // `pnpm dev` talks to a local Karya API

export default defineConfig({
  base: "/go/",
  oxc: { jsx: { runtime: "automatic" } },
  build: { outDir: "dist", target: "es2020", assetsInlineLimit: 0 },
  server: { proxy: { "/api": api, "/auth": api } },
});
