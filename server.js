const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "Cardinal Mechanical Attribution API"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok"
  });
});

app.listen(PORT, () => {
  console.log(`Cardinal Railway backend running on port ${PORT}`);
});
