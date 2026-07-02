const imageInput = document.querySelector("#imageInput");
const cameraMouthInput = document.querySelector("#cameraMouthInput");
const cameraFaceInput = document.querySelector("#cameraFaceInput");
const exportButton = document.querySelector("#exportButton");
const applyButton = document.querySelector("#applyButton");
const aiButton = document.querySelector("#aiButton");
const clearMaskButton = document.querySelector("#clearMaskButton");
const fitButton = document.querySelector("#fitButton");
const resetButton = document.querySelector("#resetButton");
const imageCanvas = document.querySelector("#imageCanvas");
const maskCanvas = document.querySelector("#maskCanvas");
const stage = document.querySelector("#canvasStage");
const emptyState = document.querySelector("#emptyState");
const aiLoader = document.querySelector("#aiLoader");
const statusTitle = document.querySelector("#statusTitle");
const statusText = document.querySelector("#statusText");
const intensityInput = document.querySelector("#intensity");
const softnessInput = document.querySelector("#softness");
const brushSizeInput = document.querySelector("#brushSize");
const intensityValue = document.querySelector("#intensityValue");
const softnessValue = document.querySelector("#softnessValue");
const brushValue = document.querySelector("#brushValue");
const maskToggle = document.querySelector("#maskToggle");
const compareToggle = document.querySelector("#beforeAfterToggle");
const toolButtons = [...document.querySelectorAll("[data-tool]")];
const treatmentButtons = [...document.querySelectorAll("[data-treatment]")];
const toothButtons = [...document.querySelectorAll("[data-tooth]")];

const imageCtx = imageCanvas.getContext("2d", { willReadFrequently: true });
const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });

const sourceCanvas = document.createElement("canvas");
const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
const beforeCanvas = document.createElement("canvas");
const beforeCtx = beforeCanvas.getContext("2d", { willReadFrequently: true });
const resultCanvas = document.createElement("canvas");
const resultCtx = resultCanvas.getContext("2d", { willReadFrequently: true });
const finalCanvas = document.createElement("canvas");
const finalCtx = finalCanvas.getContext("2d", { willReadFrequently: true });
const selectionCanvas = document.createElement("canvas");
const selectionCtx = selectionCanvas.getContext("2d", { willReadFrequently: true });
const toothCanvas = document.createElement("canvas");
const toothCtx = toothCanvas.getContext("2d", { willReadFrequently: true });
const combinedSelectionCanvas = document.createElement("canvas");
const combinedSelectionCtx = combinedSelectionCanvas.getContext("2d", {
  willReadFrequently: true,
});

let imageLoaded = false;
let currentTool = "brush";
let currentTreatment = "whitening";
let isDrawing = false;
let lastPoint = null;
let display = { x: 0, y: 0, width: 1, height: 1, scale: 1 };
let compareMode = false;
let comparePosition = 0.5;
let isComparingDrag = false;
let hasAiResult = false;
let mouthBox = null;
let dragStart = null;
let mouthBoxBeforeDrag = null;
let pendingToothBox = null;
let toothBoxes = {};

const treatments = {
  whitening: {
    title: "Blanchiment",
    warmth: -10,
    brightness: 44,
    contrast: 10,
    opacity: 0.85,
  },
  veneers: {
    title: "Facettes",
    warmth: -5,
    brightness: 58,
    contrast: 20,
    opacity: 0.9,
  },
  crown: {
    title: "Couronne",
    warmth: -4,
    brightness: 64,
    contrast: 24,
    opacity: 0.94,
  },
  alignment: {
    title: "Alignement",
    warmth: -2,
    brightness: 34,
    contrast: 18,
    opacity: 0.78,
  },
  gum: {
    title: "Gencive",
    warmth: 12,
    brightness: 18,
    contrast: 6,
    opacity: 0.68,
  },
};

const setStatus = (title, text) => {
  statusTitle.textContent = title;
  statusText.textContent = text;
};

const syncOutputs = () => {
  intensityValue.value = intensityInput.value;
  softnessValue.value = softnessInput.value;
  brushValue.value = brushSizeInput.value;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getActiveResultCanvas = () => (hasAiResult ? finalCanvas : resultCanvas);

const invalidateAiResult = () => {
  hasAiResult = false;
  compareMode = false;
  compareToggle.checked = false;
  compareToggle.disabled = true;
  window.dispatchEvent(new CustomEvent("smilecraft:resultchange", { detail: { ready: false } }));
};

const dataUrlToImage = (dataUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });

const hasSelectedTeeth = () =>
  toothButtons.some((button) => button.classList.contains("is-selected"));

const getSelectedToothIds = () =>
  toothButtons
    .filter((button) => button.classList.contains("is-selected"))
    .map((button) => button.dataset.tooth);

const getDefaultMouthBox = () => {
  const aspect = sourceCanvas.width / Math.max(1, sourceCanvas.height);
  // Square dental photos are usually mouth close-ups, not portrait faces.
  const isMouthCloseup = aspect >= 0.9;

  if (isMouthCloseup) {
    return {
      x: sourceCanvas.width * 0.08,
      y: sourceCanvas.height * 0.21,
      width: sourceCanvas.width * 0.84,
      height: sourceCanvas.height * 0.56,
    };
  }

  return {
    x: sourceCanvas.width * 0.28,
    y: sourceCanvas.height * 0.48,
    width: sourceCanvas.width * 0.44,
    height: sourceCanvas.height * 0.2,
  };
};

const getActiveMouthBox = () => mouthBox || getDefaultMouthBox();

const normalizeMouthBox = (start, end) => {
  const x1 = clamp(Math.min(start.imageX, end.imageX), 0, sourceCanvas.width);
  const y1 = clamp(Math.min(start.imageY, end.imageY), 0, sourceCanvas.height);
  const x2 = clamp(Math.max(start.imageX, end.imageX), 0, sourceCanvas.width);
  const y2 = clamp(Math.max(start.imageY, end.imageY), 0, sourceCanvas.height);
  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  };
};

const getToothLayout = (box = getActiveMouthBox()) => {
  const upper = ["13", "12", "11", "21", "22", "23"];
  const lower = ["43", "42", "41", "31", "32", "33"];
  const toothWidth = box.width / 6;
  const upperY = box.y + box.height * 0.42;
  const lowerY = box.y + box.height * 0.79;
  const layout = {};

  upper.forEach((tooth, index) => {
    layout[tooth] = {
      x: box.x + toothWidth * (index + 0.5),
      y: upperY,
      rx: toothWidth * (tooth === "11" || tooth === "21" ? 0.66 : 0.54),
      ry: box.height * (tooth === "11" || tooth === "21" ? 0.23 : 0.2),
      rotation: (index - 2.5) * 0.04,
      arch: "upper",
    };
  });

  lower.forEach((tooth, index) => {
    layout[tooth] = {
      x: box.x + toothWidth * (index + 0.5),
      y: lowerY,
      rx: toothWidth * (tooth === "41" || tooth === "31" ? 0.39 : 0.35),
      ry: box.height * (tooth === "41" || tooth === "31" ? 0.23 : 0.21),
      rotation: (2.5 - index) * 0.035,
      arch: "lower",
    };
  });

  Object.entries(toothBoxes).forEach(([tooth, customBox]) => {
    layout[tooth] = {
      x: customBox.x + customBox.width / 2,
      y: customBox.y + customBox.height / 2,
      rx: customBox.width * 0.54,
      ry: customBox.height * 0.54,
      rotation: 0,
      arch: tooth.startsWith("1") || tooth.startsWith("2") ? "upper" : "lower",
    };
  });

  return layout;
};

const fillToothShape = (ctx, tooth) => {
  const { rx, ry } = tooth;
  ctx.save();
  ctx.translate(tooth.x, tooth.y);
  ctx.rotate(tooth.rotation);
  ctx.beginPath();

  if (tooth.arch === "upper") {
    ctx.moveTo(-rx * 0.7, -ry);
    ctx.bezierCurveTo(-rx, -ry * 0.82, -rx * 1.08, ry * 0.36, -rx * 0.96, ry * 0.78);
    ctx.quadraticCurveTo(-rx * 0.5, ry * 1.03, 0, ry);
    ctx.quadraticCurveTo(rx * 0.5, ry * 1.03, rx * 0.96, ry * 0.78);
    ctx.bezierCurveTo(rx * 1.08, ry * 0.36, rx, -ry * 0.82, rx * 0.7, -ry);
    ctx.quadraticCurveTo(0, -ry * 1.08, -rx * 0.7, -ry);
  } else {
    ctx.moveTo(-rx * 0.92, -ry * 0.78);
    ctx.quadraticCurveTo(-rx * 0.48, -ry * 1.03, 0, -ry);
    ctx.quadraticCurveTo(rx * 0.48, -ry * 1.03, rx * 0.92, -ry * 0.78);
    ctx.bezierCurveTo(rx * 1.04, -ry * 0.2, rx * 0.9, ry * 0.82, rx * 0.62, ry);
    ctx.quadraticCurveTo(0, ry * 1.08, -rx * 0.62, ry);
    ctx.bezierCurveTo(-rx * 0.9, ry * 0.82, -rx * 1.04, -ry * 0.2, -rx * 0.92, -ry * 0.78);
  }

  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const updateToothMask = () => {
  toothCtx.clearRect(0, 0, toothCanvas.width, toothCanvas.height);
  if (!imageLoaded || !hasSelectedTeeth()) return;

  const layout = getToothLayout();
  toothCtx.save();
  toothCtx.globalCompositeOperation = "source-over";
  toothCtx.fillStyle = "rgba(255,255,255,1)";
  toothButtons
    .filter((button) => button.classList.contains("is-selected"))
    .forEach((button) => {
      const tooth = layout[button.dataset.tooth];
      if (!tooth) return;
      fillToothShape(toothCtx, tooth);
    });
  toothCtx.restore();
};

const getCombinedSelection = () => {
  combinedSelectionCtx.clearRect(
    0,
    0,
    combinedSelectionCanvas.width,
    combinedSelectionCanvas.height,
  );
  combinedSelectionCtx.drawImage(selectionCanvas, 0, 0);
  combinedSelectionCtx.drawImage(toothCanvas, 0, 0);
  return combinedSelectionCanvas;
};

const getTreatmentSelection = () => {
  if (currentTreatment === "crown" && getSelectedToothIds().length > 0) {
    return toothCanvas;
  }
  return getCombinedSelection();
};

const resizeStageCanvases = () => {
  const bounds = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  [imageCanvas, maskCanvas].forEach((canvas) => {
    canvas.width = Math.max(1, Math.round(bounds.width * dpr));
    canvas.height = Math.max(1, Math.round(bounds.height * dpr));
    canvas.style.width = `${bounds.width}px`;
    canvas.style.height = `${bounds.height}px`;
  });

  imageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  maskCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawView();
};

const fitImage = () => {
  if (!imageLoaded) return;

  const bounds = stage.getBoundingClientRect();
  const padding = 34;
  const availableWidth = Math.max(1, bounds.width - padding * 2);
  const availableHeight = Math.max(1, bounds.height - padding * 2);
  const scale = Math.min(
    availableWidth / sourceCanvas.width,
    availableHeight / sourceCanvas.height,
  );

  display.width = sourceCanvas.width * scale;
  display.height = sourceCanvas.height * scale;
  display.x = (bounds.width - display.width) / 2;
  display.y = (bounds.height - display.height) / 2;
  display.scale = scale;
  drawView();
};

const resetProject = () => {
  if (!imageLoaded) return;
  invalidateAiResult();
  selectionCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
  toothCtx.clearRect(0, 0, toothCanvas.width, toothCanvas.height);
  mouthBox = null;
  toothBoxes = {};
  pendingToothBox = null;
  sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  sourceCtx.drawImage(beforeCanvas, 0, 0);
  resultCtx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
  resultCtx.drawImage(beforeCanvas, 0, 0);
  toothButtons.forEach((button) => button.classList.remove("is-selected"));
  drawView();
  setStatus("Réinitialisé", "La sélection et le rendu ont été nettoyés.");
};

const getImagePoint = (event) => {
  const rect = stage.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  return {
    stageX: x,
    stageY: y,
    imageX: (x - display.x) / display.scale,
    imageY: (y - display.y) / display.scale,
  };
};

const isInsideImage = (point) =>
  point.imageX >= 0 &&
  point.imageY >= 0 &&
  point.imageX <= sourceCanvas.width &&
  point.imageY <= sourceCanvas.height;

const updateComparePosition = (event) => {
  const rect = stage.getBoundingClientRect();
  const stageX = event.clientX - rect.left;
  comparePosition = clamp((stageX - display.x) / display.width, 0, 1);
  drawView();
};

const paintSelection = (point, previousPoint = point) => {
  if (!imageLoaded || !isInsideImage(point)) return;
  invalidateAiResult();

  const size = Number(brushSizeInput.value) / display.scale;
  const targetContexts = currentTool === "erase" ? [selectionCtx, toothCtx] : [selectionCtx];

  targetContexts.forEach((ctx) => {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = size;
    ctx.globalCompositeOperation = currentTool === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = currentTool === "erase" ? "rgba(0, 0, 0, 1)" : "rgba(255, 255, 255, 1)";
    ctx.beginPath();
    ctx.moveTo(previousPoint.imageX, previousPoint.imageY);
    ctx.lineTo(point.imageX, point.imageY);
    ctx.stroke();
    ctx.restore();
  });

  renderTreatment();
};

const buildSoftMask = () => {
  const blur = Math.round((Number(softnessInput.value) / 100) * 16);
  const softCanvas = document.createElement("canvas");
  softCanvas.width = selectionCanvas.width;
  softCanvas.height = selectionCanvas.height;
  const softCtx = softCanvas.getContext("2d");
  softCtx.filter = `blur(${blur}px)`;
  softCtx.drawImage(getCombinedSelection(), 0, 0);
  return softCtx.getImageData(0, 0, softCanvas.width, softCanvas.height);
};

const renderTreatment = () => {
  if (!imageLoaded) return;

  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const base = sourceCtx.getImageData(0, 0, width, height);
  const output = resultCtx.createImageData(width, height);
  const softMask = buildSoftMask();
  const treatment = treatments[currentTreatment];
  const amount = Number(intensityInput.value) / 100;
  const opacity = treatment.opacity * amount;

  for (let i = 0; i < base.data.length; i += 4) {
    const alpha = (softMask.data[i + 3] / 255) * opacity;
    const r = base.data[i];
    const g = base.data[i + 1];
    const b = base.data[i + 2];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const toothBias = currentTreatment === "gum" ? 0.5 : clamp((luminance - 60) / 165, 0.12, 1);
    const localAlpha = alpha * toothBias;

    let targetR = r;
    let targetG = g;
    let targetB = b;

    if (currentTreatment === "gum") {
      targetR = clamp(r + treatment.brightness + 22, 0, 255);
      targetG = clamp(g + treatment.brightness - 12, 0, 255);
      targetB = clamp(b + treatment.brightness - 18, 0, 255);
    } else {
      const cooler = treatment.warmth;
      const bright = treatment.brightness * amount;
      const contrastFactor = 1 + treatment.contrast / 100;
      targetR = clamp((r - 128) * contrastFactor + 128 + bright + cooler, 0, 255);
      targetG = clamp((g - 128) * contrastFactor + 128 + bright + 6, 0, 255);
      targetB = clamp((b - 128) * contrastFactor + 128 + bright + 18 - cooler, 0, 255);

      if (currentTreatment === "veneers" || currentTreatment === "crown") {
        const porcelain = (targetR + targetG + targetB) / 3;
        const crownBoost = currentTreatment === "crown" ? 6 : 0;
        targetR = clamp(porcelain + 14 + crownBoost, 0, 255);
        targetG = clamp(porcelain + 18 + crownBoost, 0, 255);
        targetB = clamp(porcelain + 24 + crownBoost, 0, 255);
      }

      if (currentTreatment === "alignment") {
        targetR = clamp(targetR + 6, 0, 255);
        targetG = clamp(targetG + 8, 0, 255);
        targetB = clamp(targetB + 10, 0, 255);
      }
    }

    output.data[i] = Math.round(r * (1 - localAlpha) + targetR * localAlpha);
    output.data[i + 1] = Math.round(g * (1 - localAlpha) + targetG * localAlpha);
    output.data[i + 2] = Math.round(b * (1 - localAlpha) + targetB * localAlpha);
    output.data[i + 3] = base.data[i + 3];
  }

  resultCtx.putImageData(output, 0, 0);
  drawView();
};

const drawMaskOverlay = () => {
  if (!maskToggle.checked || !imageLoaded) return;

  maskCtx.save();
  maskCtx.globalCompositeOperation = "source-over";
  maskCtx.filter = "none";
  maskCtx.drawImage(getCombinedSelection(), display.x, display.y, display.width, display.height);
  maskCtx.globalCompositeOperation = "source-in";
  maskCtx.fillStyle =
    currentTool === "erase" ? "rgba(217, 107, 84, 0.38)" : "rgba(15, 123, 138, 0.32)";
  maskCtx.fillRect(display.x, display.y, display.width, display.height);
  maskCtx.restore();
};

const drawMouthGuide = () => {
  if (!imageLoaded || currentTool !== "mouth") return;

  const box = getActiveMouthBox();
  const x = display.x + box.x * display.scale;
  const y = display.y + box.y * display.scale;
  const width = box.width * display.scale;
  const height = box.height * display.scale;
  const layout = getToothLayout(box);

  maskCtx.save();
  maskCtx.lineWidth = 2;
  maskCtx.setLineDash([8, 6]);
  maskCtx.strokeStyle = currentTool === "mouth" ? "#e7bb58" : "rgba(231, 187, 88, 0.72)";
  maskCtx.strokeRect(x, y, width, height);
  maskCtx.setLineDash([]);

  if (currentTool === "mouth") {
    toothButtons
      .filter((button) => currentTool === "mouth" || button.classList.contains("is-selected"))
      .forEach((button) => {
        const tooth = layout[button.dataset.tooth];
        if (!tooth) return;
        maskCtx.beginPath();
        maskCtx.ellipse(
          display.x + tooth.x * display.scale,
          display.y + tooth.y * display.scale,
          tooth.rx * display.scale,
          tooth.ry * display.scale,
          tooth.rotation,
          0,
          Math.PI * 2,
        );
        maskCtx.strokeStyle = button.classList.contains("is-selected")
          ? "rgba(217, 107, 84, 0.86)"
          : "rgba(15, 123, 138, 0.36)";
        maskCtx.stroke();
      });
  }
  maskCtx.restore();
};

const drawToothBoxGuide = () => {
  if (!imageLoaded || currentTool !== "toothbox") return;
  const selected = getSelectedToothIds();
  if (selected.length !== 1) return;
  const box = pendingToothBox || toothBoxes[selected[0]];
  if (!box) return;

  maskCtx.save();
  maskCtx.setLineDash([7, 5]);
  maskCtx.lineWidth = 2;
  maskCtx.strokeStyle = "#efb94f";
  maskCtx.fillStyle = "rgba(239, 185, 79, 0.12)";
  const x = display.x + box.x * display.scale;
  const y = display.y + box.y * display.scale;
  const width = box.width * display.scale;
  const height = box.height * display.scale;
  maskCtx.fillRect(x, y, width, height);
  maskCtx.strokeRect(x, y, width, height);
  maskCtx.restore();
};

const drawView = () => {
  const bounds = stage.getBoundingClientRect();
  imageCtx.clearRect(0, 0, bounds.width, bounds.height);
  maskCtx.clearRect(0, 0, bounds.width, bounds.height);
  stage.classList.toggle("is-comparing", compareMode && imageLoaded);
  stage.classList.toggle("is-mouth-tool", currentTool === "mouth");
  stage.classList.toggle("is-tooth-tool", currentTool === "toothbox");
  stage.classList.toggle("is-erase-tool", currentTool === "erase");

  if (!imageLoaded) return;

  const splitX = display.x + display.width * comparePosition;
  stage.style.setProperty("--split-position", `${splitX}px`);

  if (compareMode) {
    imageCtx.save();
    imageCtx.beginPath();
    imageCtx.rect(0, 0, splitX, bounds.height);
    imageCtx.clip();
    imageCtx.drawImage(
      getActiveResultCanvas(),
      display.x,
      display.y,
      display.width,
      display.height,
    );
    imageCtx.restore();

    imageCtx.save();
    imageCtx.beginPath();
    imageCtx.rect(splitX, 0, bounds.width - splitX, bounds.height);
    imageCtx.clip();
    imageCtx.drawImage(beforeCanvas, display.x, display.y, display.width, display.height);
    imageCtx.restore();
  } else {
    imageCtx.drawImage(
      getActiveResultCanvas(),
      display.x,
      display.y,
      display.width,
      display.height,
    );
  }

  drawMaskOverlay();
  drawMouthGuide();
  drawToothBoxGuide();
};

const loadImageFile = (file) => {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxSize = 1800;
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);

      [
        sourceCanvas,
        beforeCanvas,
        resultCanvas,
        finalCanvas,
        selectionCanvas,
        toothCanvas,
        combinedSelectionCanvas,
      ].forEach((canvas) => {
        canvas.width = width;
        canvas.height = height;
      });

      beforeCtx.clearRect(0, 0, width, height);
      beforeCtx.drawImage(img, 0, 0, width, height);
      sourceCtx.clearRect(0, 0, width, height);
      sourceCtx.drawImage(beforeCanvas, 0, 0);
      resultCtx.clearRect(0, 0, width, height);
      resultCtx.drawImage(sourceCanvas, 0, 0);
      finalCtx.clearRect(0, 0, width, height);
      selectionCtx.clearRect(0, 0, width, height);
      toothCtx.clearRect(0, 0, width, height);
      mouthBox = null;
      toothBoxes = {};
      pendingToothBox = null;

      imageLoaded = true;
      invalidateAiResult();
      emptyState.classList.add("is-hidden");
      exportButton.disabled = false;
      applyButton.disabled = false;
      aiButton.disabled = false;
      clearMaskButton.disabled = false;
      fitImage();
      updateToothMask();
      renderTreatment();
      setStatus("Image chargée", `${width} x ${height}px, masque prêt.`);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
};

const exportResult = () => {
  if (!imageLoaded) return;

  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = getActiveResultCanvas().toDataURL("image/png");
  link.download = `smilecraft-resultat-${date}.png`;
  link.click();
  setStatus("Export terminé", "Le rendu PNG a été généré.");
};

const makeApiImage = () => {
  const canvas = document.createElement("canvas");
  const maxSize = 1536;
  const scale = Math.min(1, maxSize / Math.max(sourceCanvas.width, sourceCanvas.height));
  canvas.width = Math.round(sourceCanvas.width * scale);
  canvas.height = Math.round(sourceCanvas.height * scale);
  canvas.getContext("2d").drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
};

const makeApiMask = () => {
  const combined = getTreatmentSelection();
  const canvas = document.createElement("canvas");
  const maxSize = 1536;
  const scale = Math.min(1, maxSize / Math.max(combined.width, combined.height));
  canvas.width = Math.round(combined.width * scale);
  canvas.height = Math.round(combined.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(combined, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
};

const hasMaskPixels = () => {
  if (!imageLoaded) return false;
  const mask = getTreatmentSelection();
  const maskContext = mask === toothCanvas ? toothCtx : combinedSelectionCtx;
  const data = maskContext.getImageData(0, 0, mask.width, mask.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 12) return true;
  }
  return false;
};

const compositeAiResult = (editedImage) => {
  const aiCanvas = document.createElement("canvas");
  aiCanvas.width = sourceCanvas.width;
  aiCanvas.height = sourceCanvas.height;
  const aiCtx = aiCanvas.getContext("2d", { willReadFrequently: true });
  aiCtx.drawImage(editedImage, 0, 0, aiCanvas.width, aiCanvas.height);

  const original = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const generated = aiCtx.getImageData(0, 0, aiCanvas.width, aiCanvas.height);
  const featherCanvas = document.createElement("canvas");
  featherCanvas.width = sourceCanvas.width;
  featherCanvas.height = sourceCanvas.height;
  const featherCtx = featherCanvas.getContext("2d", { willReadFrequently: true });
  const featherRadius = Math.max(
    1.5,
    Math.min(4, Math.min(sourceCanvas.width, sourceCanvas.height) * 0.004),
  );
  featherCtx.filter = `blur(${featherRadius}px)`;
  featherCtx.drawImage(getTreatmentSelection(), 0, 0);
  const mask = featherCtx.getImageData(0, 0, featherCanvas.width, featherCanvas.height);
  const output = resultCtx.createImageData(sourceCanvas.width, sourceCanvas.height);

  for (let i = 0; i < original.data.length; i += 4) {
    const alpha = mask.data[i + 3] / 255;
    output.data[i] = Math.round(original.data[i] * (1 - alpha) + generated.data[i] * alpha);
    output.data[i + 1] = Math.round(
      original.data[i + 1] * (1 - alpha) + generated.data[i + 1] * alpha,
    );
    output.data[i + 2] = Math.round(
      original.data[i + 2] * (1 - alpha) + generated.data[i + 2] * alpha,
    );
    output.data[i + 3] = original.data[i + 3];
  }

  resultCtx.putImageData(output, 0, 0);
};

const runOpenAiTreatment = async () => {
  if (!imageLoaded) return;
  const selectedTeeth = getSelectedToothIds();
  if (currentTreatment === "crown" && selectedTeeth.length === 0) {
    setStatus("Dent FDI requise", "Choisis une dent, par exemple 11, avant Couronne IA.");
    return;
  }
  const automaticCrownDetection =
    currentTreatment === "crown" &&
    selectedTeeth.length === 1 &&
    !toothBoxes[selectedTeeth[0]];
  const automaticWhiteningDetection = currentTreatment === "whitening" && !hasMaskPixels();
  const automaticDetection = automaticCrownDetection || automaticWhiteningDetection;

  if (!automaticDetection && !hasMaskPixels()) {
    setStatus("Selection requise", "Selectionne les dents avant le traitement IA.");
    return;
  }

  aiButton.disabled = true;
  aiLoader.hidden = false;
  setStatus("IA en cours", "Generation OpenAI, cela peut prendre un moment.");

  try {
    const requestBody = {
      image: makeApiImage(),
      treatment: currentTreatment,
      intensity: Number(intensityInput.value),
      selectedTeeth,
      automaticDetection,
    };
    if (!automaticDetection) {
      requestBody.mask = makeApiMask();
    }

    const response = await fetch("/api/treat-smile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Traitement IA impossible.");
    }

    const editedImage = await dataUrlToImage(payload.image);
    if (automaticDetection) {
      resultCtx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
      resultCtx.drawImage(editedImage, 0, 0, resultCanvas.width, resultCanvas.height);
    } else {
      compositeAiResult(editedImage);
    }
    finalCtx.clearRect(0, 0, finalCanvas.width, finalCanvas.height);
    finalCtx.drawImage(resultCanvas, 0, 0);
    hasAiResult = true;
    maskToggle.checked = false;
    compareMode = true;
    comparePosition = 0.5;
    compareToggle.checked = true;
    compareToggle.disabled = false;
    window.dispatchEvent(new CustomEvent("smilecraft:resultchange", { detail: { ready: true } }));
    drawView();
    const selectedLabel = getSelectedToothIds().join(", ");
    setStatus(
      "Resultat IA pret",
      selectedLabel
        ? `FDI ${selectedLabel}. Apres a gauche, avant a droite.`
        : "Apres a gauche, avant a droite.",
    );
  } catch (error) {
    setStatus("Erreur IA", error.message);
  } finally {
    aiLoader.hidden = true;
    aiButton.disabled = !imageLoaded;
  }
};

const selectTooth = (button) => {
  if (!imageLoaded) {
    button.classList.toggle("is-selected");
    return;
  }

  invalidateAiResult();
  button.classList.toggle("is-selected");
  const selected = toothButtons.filter((item) => item.classList.contains("is-selected"));
  maskToggle.checked = currentTool === "toothbox";
  updateToothMask();
  renderTreatment();
  const selectedIds = selected.map((item) => item.dataset.tooth).join(", ");
  setStatus(
    "Selection FDI automatique",
    selectedIds
      ? `Dent(s) ${selectedIds}. Detection automatique prete pour Couronne IA.`
      : "Aucune dent selectionnee.",
  );
};

imageInput.addEventListener("change", (event) => {
  loadImageFile(event.target.files[0]);
});
cameraMouthInput.addEventListener("change", (event) => {
  loadImageFile(event.target.files[0]);
});
cameraFaceInput.addEventListener("change", (event) => {
  loadImageFile(event.target.files[0]);
});

stage.addEventListener("pointerdown", (event) => {
  if (!imageLoaded) return;
  const point = getImagePoint(event);
  if (!isInsideImage(point)) return;

  if (compareMode) {
    isComparingDrag = true;
    stage.setPointerCapture(event.pointerId);
    updateComparePosition(event);
    return;
  }

  if (currentTool === "toothbox") {
    const selected = getSelectedToothIds();
    if (selected.length !== 1) {
      setStatus("Une dent requise", "Selectionne une seule dent FDI avant de la cadrer.");
      return;
    }
    invalidateAiResult();
    isDrawing = true;
    dragStart = point;
    pendingToothBox = normalizeMouthBox(point, point);
    stage.setPointerCapture(event.pointerId);
    drawView();
    return;
  }

  if (currentTool === "mouth") {
    invalidateAiResult();
    isDrawing = true;
    dragStart = point;
    mouthBoxBeforeDrag = mouthBox;
    mouthBox = normalizeMouthBox(point, point);
    stage.setPointerCapture(event.pointerId);
    drawView();
    return;
  }

  isDrawing = true;
  lastPoint = point;
  stage.setPointerCapture(event.pointerId);
  paintSelection(point);
});

stage.addEventListener("pointermove", (event) => {
  if (isComparingDrag && imageLoaded) {
    updateComparePosition(event);
    return;
  }
  if (!isDrawing || !imageLoaded) return;
  const point = getImagePoint(event);

  if (currentTool === "toothbox") {
    pendingToothBox = normalizeMouthBox(dragStart, point);
    drawView();
    return;
  }

  if (currentTool === "mouth") {
    mouthBox = normalizeMouthBox(dragStart, point);
    updateToothMask();
    drawView();
    return;
  }

  paintSelection(point, lastPoint);
  lastPoint = point;
});

stage.addEventListener("pointerup", (event) => {
  if (isComparingDrag) {
    updateComparePosition(event);
    isComparingDrag = false;
    stage.releasePointerCapture(event.pointerId);
    setStatus("Comparaison", "Glisse la ligne pour voir avant et apres.");
    return;
  }
  if (!isDrawing) return;

  if (currentTool === "toothbox") {
    const selected = getSelectedToothIds();
    const point = getImagePoint(event);
    const box = normalizeMouthBox(dragStart, point);
    if (selected.length === 1 && box.width >= 12 && box.height >= 12) {
      toothBoxes[selected[0]] = box;
      updateToothMask();
      renderTreatment();
      setStatus("Dent cadree", `FDI ${selected[0]} utilise maintenant ce contour precis.`);
    } else {
      setStatus("Cadrage ignore", "Trace un rectangle plus grand autour de la dent.");
    }
    pendingToothBox = null;
    isDrawing = false;
    dragStart = null;
    stage.releasePointerCapture(event.pointerId);
    drawView();
    return;
  }

  if (currentTool === "mouth") {
    const point = getImagePoint(event);
    mouthBox = normalizeMouthBox(dragStart, point);
    if (mouthBox.width < 18 || mouthBox.height < 18) {
      mouthBox = mouthBoxBeforeDrag || getDefaultMouthBox();
    }
    updateToothMask();
    renderTreatment();
    isDrawing = false;
    dragStart = null;
    mouthBoxBeforeDrag = null;
    stage.releasePointerCapture(event.pointerId);
    setStatus("Bouche cadree", "Choisis les dents ou ajuste au pinceau.");
    return;
  }

  isDrawing = false;
  lastPoint = null;
  stage.releasePointerCapture(event.pointerId);
  setStatus("Sélection mise à jour", `${treatments[currentTreatment].title} prêt à exporter.`);
});

stage.addEventListener("pointerleave", () => {
  isDrawing = false;
  isComparingDrag = false;
  lastPoint = null;
  dragStart = null;
  mouthBoxBeforeDrag = null;
  pendingToothBox = null;
});

toolButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentTool = button.dataset.tool;
    if (
      currentTool === "brush" ||
      currentTool === "erase" ||
      currentTool === "mouth" ||
      currentTool === "toothbox"
    ) {
      maskToggle.checked = true;
    }
    toolButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    const status = {
      brush: ["Mode selection", "Peins seulement les dents a traiter."],
      mouth: ["Mode bouche", "Trace un cadre autour du sourire."],
      toothbox: ["Mode dent", "Trace un rectangle exact autour de la dent FDI selectionnee."],
      erase: ["Mode retouche", "Efface les zones en trop."],
    };
    setStatus(status[currentTool][0], status[currentTool][1]);
    drawView();
  });
});

treatmentButtons.forEach((button) => {
  button.addEventListener("click", () => {
    invalidateAiResult();
    currentTreatment = button.dataset.treatment;
    treatmentButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    renderTreatment();
    setStatus("Traitement choisi", treatments[currentTreatment].title);
  });
});

toothButtons.forEach((button) => {
  button.addEventListener("click", () => selectTooth(button));
});

[intensityInput, softnessInput, brushSizeInput].forEach((input) => {
  input.addEventListener("input", () => {
    invalidateAiResult();
    syncOutputs();
    renderTreatment();
  });
});

maskToggle.addEventListener("change", drawView);
compareToggle.addEventListener("change", () => {
  compareMode = compareToggle.checked;
  if (compareMode) comparePosition = 0.5;
  drawView();
});

applyButton.addEventListener("click", () => {
  if (!imageLoaded) return;
  sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  sourceCtx.drawImage(getActiveResultCanvas(), 0, 0);
  invalidateAiResult();
  selectionCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
  toothCtx.clearRect(0, 0, toothCanvas.width, toothCanvas.height);
  toothButtons.forEach((button) => button.classList.remove("is-selected"));
  renderTreatment();
  setStatus("Traitement appliqué", "L'image courante devient la nouvelle base.");
});

clearMaskButton.addEventListener("click", () => {
  if (!imageLoaded) return;
  invalidateAiResult();
  selectionCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
  toothCtx.clearRect(0, 0, toothCanvas.width, toothCanvas.height);
  toothButtons.forEach((button) => button.classList.remove("is-selected"));
  renderTreatment();
  setStatus("Masque effacé", "La photo reste intacte.");
});

fitButton.addEventListener("click", fitImage);
resetButton.addEventListener("click", resetProject);
exportButton.addEventListener("click", exportResult);
aiButton.addEventListener("click", runOpenAiTreatment);

window.addEventListener("resize", resizeStageCanvases);

syncOutputs();
resizeStageCanvases();

window.smileCraftStudio = {
  getSnapshot() {
    if (!imageLoaded || !hasAiResult) return null;
    return {
      originalImage: beforeCanvas.toDataURL("image/png"),
      resultImage: finalCanvas.toDataURL("image/png"),
      type: currentTreatment,
      teeth: getSelectedToothIds(),
      intensity: Number(intensityInput.value),
    };
  },
};
