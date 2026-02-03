import express from "express";
import { createRequestHandler } from "@react-router/node";

const app = express();
const port = process.env.PORT || 3000;

// Create React Router fetch handler
const handler = createRequestHandler({
  build: () => import("./build/server/index.js"),
  mode: process.env.NODE_ENV || "production",
});

// Bridge Express → Fetch → Express
app.all("*", async (req, res) => {
  try {
    const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : req,
    });

    const response = await handler(request);

    res.status(response.status);
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const body = Buffer.from(await response.arrayBuffer());
    res.send(body);
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal Server Error");
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
