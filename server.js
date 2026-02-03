import express from "express";
import { createRequestHandler } from "@react-router/node";

const app = express();

// React Router request handler using the built server bundle
const requestHandler = createRequestHandler({
  build: () => import("./build/server/index.js"),
  mode: process.env.NODE_ENV,
});

// Route all requests through React Router
app.all("*", (req, res) => {
  return requestHandler(req, res);
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${port}`);
});
