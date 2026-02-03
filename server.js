import express from "express";
import { createRequestListener } from "@react-router/node";

const app = express();
const port = process.env.PORT || 3000;

// Create React Router listener
const listener = createRequestListener({
  build: () => import("./build/server/index.js"),
  mode: process.env.NODE_ENV || "production",
});

// Use the listener as Express middleware
app.use(listener);

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
