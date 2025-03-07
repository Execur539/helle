const express = require("express");
const bodyParser = require("body-parser");
const app = express();

// Use raw body parser for analytics routes
app.use(
  "/analytics",
  bodyParser.raw({
    type: "application/json",
    limit: "10mb",
  }),
);

// Use JSON parser for other routes
app.use(bodyParser.json());

// Import and use analytics routes
const analyticsRouter = require("./routes/analytics");
app.use("/analytics", analyticsRouter);
