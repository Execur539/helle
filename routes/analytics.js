const express = require("express");
const router = express.Router();

router.post("/", (req, res) => {
  try {
    // Get the raw body as a string
    const rawBody = req.body.toString();

    // Split into lines and parse each valid JSON object
    const jsonLines = rawBody
      .split("\n")
      .filter(line => line.trim()) // Remove empty lines
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          console.warn("Invalid JSON line:", line);
          return null;
        }
      })
      .filter(obj => obj !== null);

    if (jsonLines.length > 0) {
      handleAnalyticsData(jsonLines);
      res.status(200).send("OK");
      return;
    }

    throw new Error("No valid JSON data found");
  } catch (error) {
    console.error("Analytics processing error:", error);
    res.status(400).send("Error processing analytics data");
  }
});

function handleAnalyticsData(data) {
  // Process the analytics data
  console.log("Processing analytics data:", data.length, "entries");
  // Add your analytics processing logic here
}

module.exports = router;
