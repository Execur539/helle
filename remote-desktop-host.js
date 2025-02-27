
import express from "express";
import screenshot from "screenshot-desktop";

const app = express();
app.use(express.json());

const SECRET_KEY = process.env.RDP_KEY || "Key_placeholder"; 

app.get("/sse/screenshot", async (req, res) => {
  if (req.query.key !== SECRET_KEY) return res.status(403).end();
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const interval = setInterval(async () => {
    try {
      const img = await screenshot({ format: "png" });
      const dataUrl = "data:image/png;base64," + img.toString("base64");
      res.write(`data: ${dataUrl}\n\n`);
    } catch {}
  }, 1500);

  req.on("close", () => clearInterval(interval));
});

app.post("/api/input", (req, res) => {
  if (req.query.key !== SECRET_KEY) return res.status(403).end();
  const { type, payload } = req.body;
  return res.json({ ok: true });
});

app.listen(9000, () => console.log("Remote desktop host listening on 9000"));
