const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const apiKeyPath = path.join(root, "api.txt");
const dataDir = path.join(root, "data");
const patientImagesDir = path.join(dataDir, "patient-images");
fs.mkdirSync(patientImagesDir, { recursive: true });

const encryptionKeyPath = path.join(dataDir, "app-secret.key");
const getEncryptionKey = () => {
  if (process.env.APP_ENCRYPTION_KEY) {
    return crypto.createHash("sha256").update(process.env.APP_ENCRYPTION_KEY).digest();
  }
  if (!fs.existsSync(encryptionKeyPath)) {
    fs.writeFileSync(encryptionKeyPath, crypto.randomBytes(32), { flag: "wx" });
  }
  return crypto.createHash("sha256").update(fs.readFileSync(encryptionKeyPath)).digest();
};
const encryptionKey = getEncryptionKey();

const db = new DatabaseSync(path.join(dataDir, "smilecraft.db"));
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    birth_date TEXT,
    phone TEXT,
    email TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS patients_user_id_idx ON patients(user_id);

  CREATE TABLE IF NOT EXISTS treatments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    teeth_json TEXT NOT NULL,
    intensity INTEGER NOT NULL,
    original_image_path TEXT NOT NULL,
    result_image_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS treatments_patient_id_idx ON treatments(patient_id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    operation TEXT NOT NULL,
    treatment_type TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    text_input_tokens INTEGER NOT NULL DEFAULT 0,
    image_input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS api_usage_user_id_idx ON api_usage(user_id);
`);

const ensureColumn = (table, column, definition) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};

ensureColumn("users", "role", "TEXT NOT NULL DEFAULT 'client'");
ensureColumn("users", "is_active", "INTEGER NOT NULL DEFAULT 1");

const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
if (adminCount === 0 && userCount > 0) {
  db.exec("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)");
}

db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const publicFiles = new Set(["/index.html", "/styles.css", "/app.js", "/platform.js"]);

const readApiKey = () => {
  const encrypted = db.prepare("SELECT value FROM settings WHERE key = 'openai_api_key'").get();
  if (encrypted?.value) return decryptSecret(encrypted.value);
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  if (!fs.existsSync(apiKeyPath)) return "";
  return fs.readFileSync(apiKeyPath, "utf8").trim();
};

const readBody = (request, limit = 28 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Image trop grande. Utilise une image plus petite."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

const dataUrlToBlob = (dataUrl) => {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error("Format image invalide.");
  return new Blob([Buffer.from(match[2], "base64")], { type: match[1] });
};

const sendJson = (response, status, payload, headers = {}) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
};

const encryptSecret = (plainText) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
};

const decryptSecret = (encrypted) => {
  const [version, iv, tag, ciphertext] = String(encrypted).split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Secret chiffre invalide.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
};

const getSetting = (key, fallback = "") =>
  db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? fallback;

const setSetting = (key, value) => {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, String(value), new Date().toISOString());
};

const migrateLegacyApiKey = () => {
  const stored = db.prepare("SELECT value FROM settings WHERE key = 'openai_api_key'").get();
  if (stored?.value || !fs.existsSync(apiKeyPath)) return;
  const legacyKey = fs.readFileSync(apiKeyPath, "utf8").trim();
  if (!legacyKey) return;
  const encrypted = encryptSecret(legacyKey);
  setSetting("openai_api_key", encrypted);
  if (decryptSecret(encrypted) !== legacyKey) {
    db.prepare("DELETE FROM settings WHERE key = 'openai_api_key'").run();
    throw new Error("La migration de la cle OpenAI a echoue.");
  }
  fs.writeFileSync(apiKeyPath, "", "utf8");
};

migrateLegacyApiKey();

const getNumericSetting = (key, fallback = 0) => {
  const value = Number(getSetting(key, String(fallback)));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

// Official GPT Image 2 standard rates on 2026-07-02; the admin can override them.
const defaultPricing = Object.freeze({
  textInputPerMillion: 5,
  imageInputPerMillion: 8,
  imageOutputPerMillion: 30,
  fallbackPerTreatment: 0,
});

const getPricingSettings = () => ({
  textInputPerMillion: getNumericSetting(
    "price_text_input_per_million",
    defaultPricing.textInputPerMillion,
  ),
  imageInputPerMillion: getNumericSetting(
    "price_image_input_per_million",
    defaultPricing.imageInputPerMillion,
  ),
  imageOutputPerMillion: getNumericSetting(
    "price_image_output_per_million",
    defaultPricing.imageOutputPerMillion,
  ),
  fallbackPerTreatment: getNumericSetting(
    "price_fallback_per_treatment",
    defaultPricing.fallbackPerTreatment,
  ),
});

const estimateUsageCost = (usage = {}) => {
  const pricing = getPricingSettings();
  const textInput = Number(usage.input_tokens_details?.text_tokens || 0);
  const imageInput = Number(usage.input_tokens_details?.image_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  const tokenCost =
    (textInput * pricing.textInputPerMillion +
      imageInput * pricing.imageInputPerMillion +
      output * pricing.imageOutputPerMillion) /
    1_000_000;
  return tokenCost > 0 ? tokenCost : pricing.fallbackPerTreatment;
};

const recordApiUsage = ({ userId, model, treatmentType, usage, status, errorMessage }) => {
  const details = usage?.input_tokens_details || {};
  const estimatedCost = status === "success" ? estimateUsageCost(usage) : 0;
  db.prepare(
    `INSERT INTO api_usage
     (user_id, model, operation, treatment_type, input_tokens, text_input_tokens,
      image_input_tokens, output_tokens, total_tokens, estimated_cost_usd,
      status, error_message, created_at)
     VALUES (?, ?, 'image.edit', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    model,
    treatmentType || null,
    Number(usage?.input_tokens || 0),
    Number(details.text_tokens || 0),
    Number(details.image_tokens || 0),
    Number(usage?.output_tokens || 0),
    Number(usage?.total_tokens || 0),
    estimatedCost,
    status,
    errorMessage ? cleanText(errorMessage, 1000) : null,
    new Date().toISOString(),
  );
  return estimatedCost;
};

const SESSION_COOKIE = "smilecraft_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

const parseCookies = (request) =>
  Object.fromEntries(
    (request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator === -1) return [part, ""];
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const hashPassword = (password, salt) =>
  crypto.scryptSync(password, salt, 64).toString("hex");

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const createSession = (userId) => {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000);
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(hashToken(token), userId, expiresAt.toISOString(), now.toISOString());
  return token;
};

const sessionCookie = (token, maxAge = SESSION_SECONDS) =>
  `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

const getAuthenticatedUser = (request) => {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT users.id, users.name, users.email, users.role, users.is_active
         FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.is_active = 1`,
      )
      .get(hashToken(token), new Date().toISOString()) || null
  );
};

const requireUser = (request, response) => {
  const user = getAuthenticatedUser(request);
  if (!user) sendJson(response, 401, { error: "Authentification requise." });
  return user;
};

const requireAdmin = (request, response) => {
  const user = requireUser(request, response);
  if (!user) return null;
  if (user.role !== "admin") {
    sendJson(response, 403, { error: "Acces administrateur requis." });
    return null;
  }
  return user;
};

const cleanText = (value, maxLength = 500) =>
  String(value || "")
    .trim()
    .slice(0, maxLength);

const parseJsonBody = async (request, limit) => {
  const raw = await readBody(request, limit);
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new Error("Corps JSON invalide.");
  }
};

const getPatientForUser = (patientId, userId) =>
  db.prepare("SELECT * FROM patients WHERE id = ? AND user_id = ?").get(patientId, userId) || null;

const savePrivateImage = (dataUrl, prefix) => {
  const match = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
  if (!match) throw new Error("Format d'image patient invalide.");
  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 15 * 1024 * 1024) throw new Error("Image patient trop grande.");
  const filename = `${prefix}-${crypto.randomUUID()}.${extension}`;
  fs.writeFileSync(path.join(patientImagesDir, filename), bytes, { flag: "wx" });
  return filename;
};

const treatmentPrompts = {
  whitening:
    "Natural cosmetic dental whitening on only the masked teeth. Preserve the exact face, lips, gums, tooth shape, shadows, lighting, camera angle, and identity. Make teeth cleaner and brighter but realistic, not overexposed.",
  veneers:
    "Realistic dental veneer smile preview on only the masked teeth. Preserve the exact face, lips, gums, pose, identity, and lighting. Make enamel smoother, more even, and natural with believable translucency.",
  crown:
    "Replace the entire visible clinical crown of only the selected masked FDI tooth, from its gingival margin through both proximal sides to its complete incisal or occlusal edge, with a realistic full-coverage ceramic crown. This must be a complete anatomical tooth replacement, never a small patch, oval insert, floating shape, or rectangular block. Reconstruct natural proportions, emergence profile, contact points, enamel texture, highlights, shadows, and subtle ceramic translucency. Match the incisal height, contour, shade, and lighting of the contralateral equivalent tooth while preserving natural asymmetry. Preserve every neighboring tooth, gum papilla, lip, face, identity, camera angle, and background exactly.",
  alignment:
    "Subtle orthodontic smile preview on only the masked teeth. Preserve the exact face, lips, gums, identity, and lighting. Make tooth edges and spacing slightly more regular while keeping the smile natural.",
  gum:
    "Natural gingival contour improvement on only the masked mouth area. Preserve identity, lips, teeth position, lighting, and camera angle. Smooth the gum contour gently without changing the face.",
};

const fdiToothDescriptions = {
  11: "FDI 11, the patient's upper right central incisor, appearing just left of the image midline in a frontal view",
  12: "FDI 12, the patient's upper right lateral incisor",
  13: "FDI 13, the patient's upper right canine",
  21: "FDI 21, the patient's upper left central incisor, appearing just right of the image midline in a frontal view",
  22: "FDI 22, the patient's upper left lateral incisor",
  23: "FDI 23, the patient's upper left canine",
  31: "FDI 31, the patient's lower left central incisor",
  32: "FDI 32, the patient's lower left lateral incisor",
  33: "FDI 33, the patient's lower left canine",
  41: "FDI 41, the patient's lower right central incisor",
  42: "FDI 42, the patient's lower right lateral incisor",
  43: "FDI 43, the patient's lower right canine",
};

const handleRegister = async (request, response) => {
  const body = await parseJsonBody(request);
  const name = cleanText(body.name, 80);
  const email = cleanText(body.email, 160).toLowerCase();
  const password = String(body.password || "");
  if (!name || !email.includes("@") || password.length < 8) {
    sendJson(response, 400, {
      error: "Nom, email valide et mot de passe de 8 caracteres minimum requis.",
    });
    return;
  }

  const salt = crypto.randomBytes(16).toString("hex");
  try {
    const role = db.prepare("SELECT COUNT(*) AS count FROM users").get().count === 0 ? "admin" : "client";
    const result = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, password_salt, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(name, email, hashPassword(password, salt), salt, role, new Date().toISOString());
    const userId = Number(result.lastInsertRowid);
    const token = createSession(userId);
    sendJson(
      response,
      201,
      { user: { id: userId, name, email, role } },
      { "Set-Cookie": sessionCookie(token) },
    );
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      sendJson(response, 409, { error: "Un compte existe deja avec cet email." });
      return;
    }
    throw error;
  }
};

const handleLogin = async (request, response) => {
  const body = await parseJsonBody(request);
  const email = cleanText(body.email, 160).toLowerCase();
  const password = String(body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (
    !user ||
    !user.is_active ||
    !safeEqual(hashPassword(password, user.password_salt), user.password_hash)
  ) {
    sendJson(response, 401, { error: "Email ou mot de passe incorrect." });
    return;
  }
  const token = createSession(user.id);
  sendJson(
    response,
    200,
    { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
    { "Set-Cookie": sessionCookie(token) },
  );
};

const handleLogout = (request, response) => {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  sendJson(response, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
};

const handlePatients = async (request, response, user) => {
  if (request.method === "GET") {
    const patients = db
      .prepare(
        `SELECT id, first_name, last_name, birth_date, phone, email, notes, created_at, updated_at
         FROM patients WHERE user_id = ? ORDER BY updated_at DESC`,
      )
      .all(user.id);
    sendJson(response, 200, { patients });
    return;
  }

  if (request.method === "POST") {
    const body = await parseJsonBody(request);
    const firstName = cleanText(body.firstName, 80);
    const lastName = cleanText(body.lastName, 80);
    if (!firstName || !lastName) {
      sendJson(response, 400, { error: "Prenom et nom du patient requis." });
      return;
    }
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `INSERT INTO patients
         (user_id, first_name, last_name, birth_date, phone, email, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        firstName,
        lastName,
        cleanText(body.birthDate, 10) || null,
        cleanText(body.phone, 40) || null,
        cleanText(body.email, 160) || null,
        cleanText(body.notes, 2000) || null,
        now,
        now,
      );
    const patient = getPatientForUser(Number(result.lastInsertRowid), user.id);
    sendJson(response, 201, { patient });
    return;
  }

  sendJson(response, 405, { error: "Methode non autorisee." });
};

const handlePatientById = async (request, response, user, patientId) => {
  const patient = getPatientForUser(patientId, user.id);
  if (!patient) {
    sendJson(response, 404, { error: "Patient introuvable." });
    return;
  }

  if (request.method === "PUT") {
    const body = await parseJsonBody(request);
    const firstName = cleanText(body.firstName, 80);
    const lastName = cleanText(body.lastName, 80);
    if (!firstName || !lastName) {
      sendJson(response, 400, { error: "Prenom et nom du patient requis." });
      return;
    }
    db.prepare(
      `UPDATE patients SET first_name = ?, last_name = ?, birth_date = ?, phone = ?,
       email = ?, notes = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    ).run(
      firstName,
      lastName,
      cleanText(body.birthDate, 10) || null,
      cleanText(body.phone, 40) || null,
      cleanText(body.email, 160) || null,
      cleanText(body.notes, 2000) || null,
      new Date().toISOString(),
      patientId,
      user.id,
    );
    sendJson(response, 200, { patient: getPatientForUser(patientId, user.id) });
    return;
  }

  if (request.method === "DELETE") {
    const images = db
      .prepare(
        "SELECT original_image_path, result_image_path FROM treatments WHERE patient_id = ? AND user_id = ?",
      )
      .all(patientId, user.id);
    db.prepare("DELETE FROM patients WHERE id = ? AND user_id = ?").run(patientId, user.id);
    images.forEach((item) => {
      [item.original_image_path, item.result_image_path].forEach((filename) => {
        try {
          fs.unlinkSync(path.join(patientImagesDir, filename));
        } catch {}
      });
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 405, { error: "Methode non autorisee." });
};

const treatmentPayload = (row) => ({
  id: row.id,
  patientId: row.patient_id,
  type: row.type,
  teeth: JSON.parse(row.teeth_json || "[]"),
  intensity: row.intensity,
  createdAt: row.created_at,
  originalUrl: `/api/treatments/${row.id}/image/original`,
  resultUrl: `/api/treatments/${row.id}/image/result`,
});

const handleTreatments = async (request, response, user, patientId) => {
  const patient = getPatientForUser(patientId, user.id);
  if (!patient) {
    sendJson(response, 404, { error: "Patient introuvable." });
    return;
  }

  if (request.method === "GET") {
    const treatments = db
      .prepare("SELECT * FROM treatments WHERE patient_id = ? AND user_id = ? ORDER BY created_at DESC")
      .all(patientId, user.id)
      .map(treatmentPayload);
    sendJson(response, 200, { treatments });
    return;
  }

  if (request.method === "POST") {
    const body = await parseJsonBody(request, 48 * 1024 * 1024);
    const type = cleanText(body.type, 40);
    const teeth = Array.isArray(body.teeth) ? body.teeth.map((item) => cleanText(item, 2)) : [];
    if (!type || !body.originalImage || !body.resultImage) {
      sendJson(response, 400, { error: "Images et traitement requis." });
      return;
    }
    let originalPath;
    let resultPath;
    try {
      originalPath = savePrivateImage(body.originalImage, `u${user.id}-p${patientId}-before`);
      resultPath = savePrivateImage(body.resultImage, `u${user.id}-p${patientId}-after`);
      const result = db
        .prepare(
          `INSERT INTO treatments
           (user_id, patient_id, type, teeth_json, intensity, original_image_path, result_image_path, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          user.id,
          patientId,
          type,
          JSON.stringify(teeth),
          Math.max(0, Math.min(100, Number(body.intensity) || 0)),
          originalPath,
          resultPath,
          new Date().toISOString(),
        );
      const treatment = db.prepare("SELECT * FROM treatments WHERE id = ?").get(result.lastInsertRowid);
      sendJson(response, 201, { treatment: treatmentPayload(treatment) });
    } catch (error) {
      [originalPath, resultPath].filter(Boolean).forEach((filename) => {
        try {
          fs.unlinkSync(path.join(patientImagesDir, filename));
        } catch {}
      });
      throw error;
    }
    return;
  }

  sendJson(response, 405, { error: "Methode non autorisee." });
};

const handleTreatmentImage = (request, response, user, treatmentId, kind) => {
  const row = db
    .prepare("SELECT * FROM treatments WHERE id = ? AND user_id = ?")
    .get(treatmentId, user.id);
  if (!row) {
    sendJson(response, 404, { error: "Traitement introuvable." });
    return;
  }
  const filename = kind === "original" ? row.original_image_path : row.result_image_path;
  const filePath = path.join(patientImagesDir, filename);
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(response, 404, { error: "Image introuvable." });
      return;
    }
    response.writeHead(200, { "Content-Type": `image/${path.extname(filename).slice(1)}` });
    response.end(data);
  });
};

const handleAdminSettings = async (request, response) => {
  if (request.method === "GET") {
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'openai_api_key'").get();
    let lastFour = "";
    if (stored?.value) {
      try {
        lastFour = decryptSecret(stored.value).slice(-4);
      } catch {}
    }
    sendJson(response, 200, {
      apiKeyConfigured: Boolean(stored?.value || process.env.OPENAI_API_KEY || readApiKey()),
      apiKeySource: stored?.value ? "database" : process.env.OPENAI_API_KEY ? "environment" : "file",
      apiKeyLastFour: lastFour,
      pricing: getPricingSettings(),
    });
    return;
  }

  if (request.method === "PUT") {
    const body = await parseJsonBody(request);
    const apiKey = String(body.openaiApiKey || "").trim();
    if (apiKey) setSetting("openai_api_key", encryptSecret(apiKey));
    if (body.removeApiKey === true) {
      db.prepare("DELETE FROM settings WHERE key = 'openai_api_key'").run();
    }
    const pricing = body.pricing || {};
    const values = {
      price_text_input_per_million: pricing.textInputPerMillion,
      price_image_input_per_million: pricing.imageInputPerMillion,
      price_image_output_per_million: pricing.imageOutputPerMillion,
      price_fallback_per_treatment: pricing.fallbackPerTreatment,
    };
    Object.entries(values).forEach(([key, value]) => {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) setSetting(key, number);
    });
    sendJson(response, 200, { ok: true, pricing: getPricingSettings() });
    return;
  }

  sendJson(response, 405, { error: "Methode non autorisee." });
};

const handleAdminClients = async (request, response) => {
  if (request.method === "GET") {
    const clients = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.is_active, u.created_at,
          (SELECT COUNT(*) FROM patients p WHERE p.user_id = u.id) AS patient_count,
          (SELECT COUNT(*) FROM treatments t WHERE t.user_id = u.id) AS treatment_count,
          (SELECT COUNT(*) FROM api_usage a WHERE a.user_id = u.id AND a.status = 'success') AS api_calls,
          (SELECT COALESCE(SUM(a.total_tokens), 0) FROM api_usage a WHERE a.user_id = u.id) AS total_tokens,
          (SELECT COALESCE(SUM(a.estimated_cost_usd), 0) FROM api_usage a WHERE a.user_id = u.id) AS estimated_cost_usd
         FROM users u WHERE u.role = 'client' ORDER BY u.created_at DESC`,
      )
      .all();
    const summary = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM users WHERE role = 'client') AS clients,
          (SELECT COUNT(*) FROM patients) AS patients,
          (SELECT COUNT(*) FROM treatments) AS treatments,
          (SELECT COUNT(*) FROM api_usage WHERE status = 'success') AS api_calls,
          (SELECT COALESCE(SUM(total_tokens), 0) FROM api_usage) AS total_tokens,
          (SELECT COALESCE(SUM(estimated_cost_usd), 0) FROM api_usage) AS estimated_cost_usd`,
      )
      .get();
    sendJson(response, 200, { clients, summary });
    return;
  }

  if (request.method === "POST") {
    const body = await parseJsonBody(request);
    const name = cleanText(body.name, 80);
    const email = cleanText(body.email, 160).toLowerCase();
    const password = String(body.password || "");
    if (!name || !email.includes("@") || password.length < 8) {
      sendJson(response, 400, { error: "Nom, email et mot de passe de 8 caracteres requis." });
      return;
    }
    const salt = crypto.randomBytes(16).toString("hex");
    try {
      const result = db
        .prepare(
          `INSERT INTO users (name, email, password_hash, password_salt, role, created_at)
           VALUES (?, ?, ?, ?, 'client', ?)`,
        )
        .run(name, email, hashPassword(password, salt), salt, new Date().toISOString());
      sendJson(response, 201, {
        client: { id: Number(result.lastInsertRowid), name, email, is_active: 1 },
      });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        sendJson(response, 409, { error: "Cet email est deja utilise." });
        return;
      }
      throw error;
    }
    return;
  }

  sendJson(response, 405, { error: "Methode non autorisee." });
};

const handleAdminClientById = async (request, response, clientId) => {
  const client = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'client'").get(clientId);
  if (!client) {
    sendJson(response, 404, { error: "Client introuvable." });
    return;
  }
  if (request.method === "PUT") {
    const body = await parseJsonBody(request);
    const isActive = body.isActive === false ? 0 : 1;
    db.prepare("UPDATE users SET is_active = ? WHERE id = ? AND role = 'client'").run(
      isActive,
      clientId,
    );
    if (!isActive) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(clientId);
    sendJson(response, 200, { ok: true, isActive: Boolean(isActive) });
    return;
  }
  sendJson(response, 405, { error: "Methode non autorisee." });
};

const handleAdminUsage = (request, response, url) => {
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const daily = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day,
       COUNT(*) AS calls, COALESCE(SUM(total_tokens), 0) AS tokens,
       COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd
       FROM api_usage WHERE created_at >= ? GROUP BY day ORDER BY day`,
    )
    .all(since);
  sendJson(response, 200, { days, daily });
};

const handleAiTreatment = async (request, response, user) => {
  const model = "gpt-image-2";
  let body = {};
  try {
    const apiKey = readApiKey();
    if (!apiKey) {
      sendJson(response, 400, {
        error: "api.txt est vide. Mets ta cle OpenAI dans api.txt puis relance le serveur.",
      });
      return;
    }

    body = JSON.parse(await readBody(request));
    if (!body.image || (!body.mask && !body.automaticDetection)) {
      sendJson(response, 400, { error: "Image obligatoire; masque requis hors detection automatique." });
      return;
    }

    const promptBase = treatmentPrompts[body.treatment] || treatmentPrompts.whitening;
    const selectedTeeth = Array.isArray(body.selectedTeeth)
      ? body.selectedTeeth.filter((tooth) => fdiToothDescriptions[tooth])
      : [];
    const selectedDescription = selectedTeeth
      .map((tooth) => fdiToothDescriptions[tooth])
      .join("; ");
    const toothTarget =
      body.automaticDetection && body.treatment === "whitening"
        ? "Target all visible natural tooth surfaces in the smile, including upper and lower visible teeth."
        : selectedDescription
          ? `Target only: ${selectedDescription}.`
          : "Target only the tooth surfaces inside the transparent mask.";
    const singleCrownRule =
      body.treatment === "crown" && selectedTeeth.length === 1
        ? "Create exactly one crown on that single FDI tooth. Do not crown, whiten, align, reshape, recolor, or repair any neighboring tooth."
        : "";
    const detectionRule = body.automaticDetection
      ? body.treatment === "whitening"
        ? "Visually detect every visible tooth surface directly from the full dental photograph and whiten only those enamel surfaces evenly and naturally. Do not change tooth shapes, positions, spacing, texture, translucency, restorations, gums, interdental papillae, lips, skin, framing, crop, lighting, or background."
        : "Visually locate the named FDI tooth directly from the full dental photograph. Change only that tooth. Keep every other tooth pixel-for-pixel visually identical, including its shape, shade, texture, position, highlights, and shadows. Keep the gums, interdental papillae, lips, skin, framing, crop, lighting, and background unchanged."
      : "The transparent mask is the only editable region. Preserve every unmasked pixel exactly.";
    const prompt = `${promptBase} ${toothTarget} ${singleCrownRule} ${detectionRule} Treatment strength: ${body.intensity || 60}/100. Do not add text, watermarks, tools, braces, or new objects. This is a visual dental simulation, not a medical diagnosis.`;
    const form = new FormData();
    form.append("model", model);
    form.append("image", dataUrlToBlob(body.image), "smile-source.png");
    if (body.mask) {
      form.append("mask", dataUrlToBlob(body.mask), "smile-mask.png");
    }
    form.append("prompt", prompt);
    form.append("size", "auto");
    form.append("quality", "medium");
    form.append("output_format", "png");

    const apiResponse = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    const apiPayload = await apiResponse.json();
    if (!apiResponse.ok) {
      recordApiUsage({
        userId: user.id,
        model,
        treatmentType: body.treatment,
        status: "error",
        errorMessage: apiPayload.error?.message,
      });
      sendJson(response, apiResponse.status, {
        error: apiPayload.error?.message || "OpenAI a refuse la generation.",
      });
      return;
    }

    const b64 = apiPayload.data?.[0]?.b64_json;
    if (!b64) {
      recordApiUsage({
        userId: user.id,
        model,
        treatmentType: body.treatment,
        status: "error",
        errorMessage: "OpenAI n'a pas renvoye d'image.",
      });
      sendJson(response, 502, { error: "OpenAI n'a pas renvoye d'image." });
      return;
    }

    const estimatedCostUsd = recordApiUsage({
      userId: user.id,
      model,
      treatmentType: body.treatment,
      usage: apiPayload.usage,
      status: "success",
    });
    sendJson(response, 200, {
      image: `data:image/png;base64,${b64}`,
      usage: apiPayload.usage || null,
      estimatedCostUsd,
    });
  } catch (error) {
    recordApiUsage({
      userId: user.id,
      model,
      treatmentType: body.treatment,
      status: "error",
      errorMessage: error.message,
    });
    sendJson(response, 500, { error: error.message || "Erreur serveur." });
  }
};

const handleApi = async (request, response, url) => {
  try {
    if (request.method === "POST" && url.pathname === "/api/auth/register") {
      await handleRegister(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      await handleLogin(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      handleLogout(request, response);
      return;
    }

    const user = requireUser(request, response);
    if (!user) return;

    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      sendJson(response, 200, { user });
      return;
    }

    if (url.pathname.startsWith("/api/admin/")) {
      if (user.role !== "admin") {
        sendJson(response, 403, { error: "Acces administrateur requis." });
        return;
      }
      if (url.pathname === "/api/admin/settings") {
        await handleAdminSettings(request, response);
        return;
      }
      if (url.pathname === "/api/admin/clients") {
        await handleAdminClients(request, response);
        return;
      }
      const adminClientMatch = url.pathname.match(/^\/api\/admin\/clients\/(\d+)$/);
      if (adminClientMatch) {
        await handleAdminClientById(request, response, Number(adminClientMatch[1]));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/admin/usage") {
        handleAdminUsage(request, response, url);
        return;
      }
    }
    if (url.pathname === "/api/patients") {
      await handlePatients(request, response, user);
      return;
    }

    const patientMatch = url.pathname.match(/^\/api\/patients\/(\d+)$/);
    if (patientMatch) {
      await handlePatientById(request, response, user, Number(patientMatch[1]));
      return;
    }

    const treatmentsMatch = url.pathname.match(/^\/api\/patients\/(\d+)\/treatments$/);
    if (treatmentsMatch) {
      await handleTreatments(request, response, user, Number(treatmentsMatch[1]));
      return;
    }

    const imageMatch = url.pathname.match(/^\/api\/treatments\/(\d+)\/image\/(original|result)$/);
    if (request.method === "GET" && imageMatch) {
      handleTreatmentImage(request, response, user, Number(imageMatch[1]), imageMatch[2]);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/treat-smile") {
      await handleAiTreatment(request, response, user);
      return;
    }

    sendJson(response, 404, { error: "Route API introuvable." });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Erreur serveur." });
  }
};

const serveStatic = (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  if (!publicFiles.has(pathname)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const filePath = path.normalize(path.join(root, pathname));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    });
    response.end(data);
  });
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(request, response, url);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    serveStatic(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
});

server.listen(port, () => {
  console.log(`SmileCraft serveur: http://localhost:${port}`);
});
