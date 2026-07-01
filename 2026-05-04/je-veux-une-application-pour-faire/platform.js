const authOverlay = document.querySelector("#authOverlay");
const authForm = document.querySelector("#authForm");
const authNameField = document.querySelector(".auth-name-field");
const authName = document.querySelector("#authName");
const authEmail = document.querySelector("#authEmail");
const authPassword = document.querySelector("#authPassword");
const authError = document.querySelector("#authError");
const authSubmit = document.querySelector("#authSubmit");
const loginTab = document.querySelector("#loginTab");
const registerTab = document.querySelector("#registerTab");
const logoutButton = document.querySelector("#logoutButton");
const patientsButton = document.querySelector("#patientsButton");
const currentPatientButton = document.querySelector("#currentPatientButton");
const patientOverlay = document.querySelector("#patientOverlay");
const closePatientsButton = document.querySelector("#closePatientsButton");
const newPatientButton = document.querySelector("#newPatientButton");
const patientList = document.querySelector("#patientList");
const patientForm = document.querySelector("#patientForm");
const patientId = document.querySelector("#patientId");
const patientFirstName = document.querySelector("#patientFirstName");
const patientLastName = document.querySelector("#patientLastName");
const patientBirthDate = document.querySelector("#patientBirthDate");
const patientPhone = document.querySelector("#patientPhone");
const patientEmail = document.querySelector("#patientEmail");
const patientNotes = document.querySelector("#patientNotes");
const patientError = document.querySelector("#patientError");
const deletePatientButton = document.querySelector("#deletePatientButton");
const treatmentHistory = document.querySelector("#treatmentHistory");
const historyCount = document.querySelector("#historyCount");
const saveTreatmentButton = document.querySelector("#saveTreatmentButton");

let authMode = "login";
let signedInUser = null;
let patients = [];
let currentPatient = null;

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: options.body
      ? { "Content-Type": "application/json", ...(options.headers || {}) }
      : options.headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Operation impossible.");
    error.status = response.status;
    throw error;
  }
  return payload;
};

const setAuthMode = (mode) => {
  authMode = mode;
  const registering = mode === "register";
  loginTab.classList.toggle("is-active", !registering);
  registerTab.classList.toggle("is-active", registering);
  authNameField.hidden = !registering;
  authName.required = registering;
  authPassword.autocomplete = registering ? "new-password" : "current-password";
  authSubmit.textContent = registering ? "Creer le compte" : "Se connecter";
  authError.textContent = "";
};

const updateSaveButton = () => {
  const snapshot = window.smileCraftStudio?.getSnapshot();
  saveTreatmentButton.disabled = !currentPatient || !snapshot;
};

const resetPatientForm = () => {
  patientForm.reset();
  patientId.value = "";
  patientError.textContent = "";
  deletePatientButton.disabled = true;
  treatmentHistory.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "history-empty";
  empty.textContent = "Enregistre le patient pour ajouter des traitements.";
  treatmentHistory.append(empty);
  historyCount.textContent = "0";
};

const patientLabel = (patient) => `${patient.first_name} ${patient.last_name}`;

const renderPatientList = () => {
  patientList.replaceChildren();
  if (!patients.length) {
    const empty = document.createElement("p");
    empty.className = "patient-empty";
    empty.textContent = "Aucun patient dans ce compte.";
    patientList.append(empty);
    return;
  }
  patients.forEach((patient) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "patient-row";
    button.classList.toggle("is-active", currentPatient?.id === patient.id);
    const name = document.createElement("strong");
    name.textContent = patientLabel(patient);
    const meta = document.createElement("small");
    meta.textContent = patient.phone || patient.email || "Dossier patient";
    button.append(name, meta);
    button.addEventListener("click", () => selectPatient(patient.id));
    patientList.append(button);
  });
};

const renderHistory = (items) => {
  treatmentHistory.replaceChildren();
  historyCount.textContent = String(items.length);
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "Aucun traitement enregistre.";
    treatmentHistory.append(empty);
    return;
  }
  items.forEach((item) => {
    const article = document.createElement("article");
    article.className = "history-item";
    const images = document.createElement("div");
    images.className = "history-images";
    const before = document.createElement("img");
    before.src = item.originalUrl;
    before.alt = "Avant traitement";
    const after = document.createElement("img");
    after.src = item.resultUrl;
    after.alt = "Apres traitement";
    images.append(before, after);
    const meta = document.createElement("div");
    meta.className = "history-meta";
    const title = document.createElement("strong");
    title.textContent = `${item.type} ${item.teeth.length ? `- FDI ${item.teeth.join(", ")}` : ""}`;
    const date = document.createElement("small");
    date.textContent = new Date(item.createdAt).toLocaleString("fr-FR");
    meta.append(title, date);
    article.append(images, meta);
    treatmentHistory.append(article);
  });
};

const loadHistory = async () => {
  if (!currentPatient) return renderHistory([]);
  const payload = await api(`/api/patients/${currentPatient.id}/treatments`);
  renderHistory(payload.treatments);
};

const selectPatient = async (id) => {
  currentPatient = patients.find((patient) => patient.id === id) || null;
  if (!currentPatient) return;
  patientId.value = String(currentPatient.id);
  patientFirstName.value = currentPatient.first_name || "";
  patientLastName.value = currentPatient.last_name || "";
  patientBirthDate.value = currentPatient.birth_date || "";
  patientPhone.value = currentPatient.phone || "";
  patientEmail.value = currentPatient.email || "";
  patientNotes.value = currentPatient.notes || "";
  deletePatientButton.disabled = false;
  currentPatientButton.disabled = false;
  currentPatientButton.textContent = patientLabel(currentPatient);
  renderPatientList();
  updateSaveButton();
  await loadHistory();
};

const loadPatients = async () => {
  const payload = await api("/api/patients");
  patients = payload.patients;
  if (currentPatient) {
    currentPatient = patients.find((patient) => patient.id === currentPatient.id) || null;
  }
  renderPatientList();
  if (currentPatient) await selectPatient(currentPatient.id);
};

const openPatients = async () => {
  patientOverlay.hidden = false;
  await loadPatients();
  if (!patients.length) resetPatientForm();
};

loginTab.addEventListener("click", () => setAuthMode("login"));
registerTab.addEventListener("click", () => setAuthMode("register"));

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  authSubmit.disabled = true;
  try {
    const payload = await api(`/api/auth/${authMode}`, {
      method: "POST",
      body: JSON.stringify({
        name: authName.value,
        email: authEmail.value,
        password: authPassword.value,
      }),
    });
    signedInUser = payload.user;
    authOverlay.hidden = true;
    authForm.reset();
    await loadPatients();
    if (!patients.length) await openPatients();
  } catch (error) {
    authError.textContent = error.message;
  } finally {
    authSubmit.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  signedInUser = null;
  currentPatient = null;
  patients = [];
  currentPatientButton.disabled = true;
  currentPatientButton.textContent = "Aucun patient";
  patientOverlay.hidden = true;
  authOverlay.hidden = false;
  updateSaveButton();
});

patientsButton.addEventListener("click", openPatients);
currentPatientButton.addEventListener("click", openPatients);
closePatientsButton.addEventListener("click", () => {
  patientOverlay.hidden = true;
});
newPatientButton.addEventListener("click", resetPatientForm);

patientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  patientError.textContent = "";
  const id = patientId.value;
  try {
    const payload = await api(id ? `/api/patients/${id}` : "/api/patients", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({
        firstName: patientFirstName.value,
        lastName: patientLastName.value,
        birthDate: patientBirthDate.value,
        phone: patientPhone.value,
        email: patientEmail.value,
        notes: patientNotes.value,
      }),
    });
    currentPatient = payload.patient;
    await loadPatients();
    await selectPatient(currentPatient.id);
  } catch (error) {
    patientError.textContent = error.message;
  }
});

deletePatientButton.addEventListener("click", async () => {
  if (!currentPatient || !window.confirm(`Supprimer le dossier de ${patientLabel(currentPatient)} ?`)) return;
  try {
    await api(`/api/patients/${currentPatient.id}`, { method: "DELETE" });
    currentPatient = null;
    currentPatientButton.disabled = true;
    currentPatientButton.textContent = "Aucun patient";
    resetPatientForm();
    await loadPatients();
    updateSaveButton();
  } catch (error) {
    patientError.textContent = error.message;
  }
});

saveTreatmentButton.addEventListener("click", async () => {
  const snapshot = window.smileCraftStudio?.getSnapshot();
  if (!currentPatient) {
    await openPatients();
    return;
  }
  if (!snapshot) return;
  saveTreatmentButton.disabled = true;
  try {
    await api(`/api/patients/${currentPatient.id}/treatments`, {
      method: "POST",
      body: JSON.stringify(snapshot),
    });
    await loadHistory();
    saveTreatmentButton.classList.add("is-saved");
    window.setTimeout(() => {
      saveTreatmentButton.classList.remove("is-saved");
      updateSaveButton();
    }, 1400);
  } catch (error) {
    window.alert(error.message);
    updateSaveButton();
  }
});

window.addEventListener("smilecraft:resultchange", updateSaveButton);

const initializePlatform = async () => {
  setAuthMode("login");
  try {
    const payload = await api("/api/auth/me");
    signedInUser = payload.user;
    authOverlay.hidden = true;
    await loadPatients();
  } catch (error) {
    authOverlay.hidden = false;
  }
  updateSaveButton();
};

initializePlatform();
