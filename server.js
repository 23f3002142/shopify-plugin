import "dotenv/config";
import express from "express";
import { createRequestListener } from "@react-router/node";

const app = express();
const port = process.env.PORT || 3000;

// Log env vars for debugging (remove in production)
console.log("ENV CHECK:", {
  SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY ? "SET" : "MISSING",
  SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET ? "SET" : "MISSING",
  SCOPES: process.env.SCOPES,
  SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL,
  NODE_ENV: process.env.NODE_ENV,
});

// Simple health check to confirm Express is up
app.get("/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Create React Router listener
let listener;
try {
  listener = createRequestListener({
    build: () => import("./build/server/index.js"),
    mode: process.env.NODE_ENV || "production",
  });
  console.log("✅ React Router listener created successfully");
} catch (err) {
  console.error("❌ Failed to create React Router listener:", err);
  process.exit(1);
}

// Use the listener for all other routes (catch-all)
app.use(listener);

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
