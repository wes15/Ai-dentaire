const fs = require("node:fs");
const path = require("node:path");

const toDataUrl = (filePath) => {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
};

const main = async () => {
  const response = await fetch("http://localhost:3000/api/treat-smile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: toDataUrl(path.join(__dirname, "test-source.png")),
      mask: toDataUrl(path.join(__dirname, "test-mask.png")),
      treatment: "whitening",
      intensity: 70,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  const base64 = payload.image.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(path.join(__dirname, "test-openai-result.png"), Buffer.from(base64, "base64"));
  console.log("OK test-openai-result.png");
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
