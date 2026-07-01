const fs = require("node:fs");
const path = require("node:path");

const toDataUrl = (filePath) =>
  `data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}`;

const main = async () => {
  const sourcePath = "C:\\Users\\FULL_MSI\\Downloads\\ai dent.png";
  const response = await fetch("http://localhost:3000/api/treat-smile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: toDataUrl(sourcePath),
      treatment: "crown",
      intensity: 70,
      selectedTeeth: ["11"],
      automaticDetection: true,
    }),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  const outputPath = path.join(__dirname, "test-crown-11-result.png");
  fs.writeFileSync(
    outputPath,
    Buffer.from(payload.image.replace(/^data:image\/png;base64,/, ""), "base64"),
  );
  console.log(outputPath);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
