/**
 * IITI Spark configuration and one-time setup.
 * Run setupProject(), then configureApp(WEB_CLIENT_ID, "iiti.ac.in", ALLOWED_WEB_ORIGINS).
 */

const CORE_SHEETS = Object.freeze({
  USERS: [
    "userId", "email", "googleName", "displayName", "photoUrl", "program", "year",
    "gender", "lookingFor", "bio", "interestsJson", "allowDiscovery", "ageConfirmed",
    "termsVersion", "termsAcceptedAt", "profileComplete", "status", "createdAt",
    "updatedAt", "lastSeenAt"
  ],
  MATCHES: [
    "matchId", "userA", "userB", "status", "createdAt", "lastMessageAt",
    "lastMessagePreview", "blockedBy"
  ],
  SESSIONS: [
    "sessionHash", "userId", "expiresAt", "createdAt", "lastSeenAt", "status"
  ],
  LIKES_INDEX: [
    "key", "likerId", "likedId", "status", "createdAt", "updatedAt"
  ],
  BLOCKS: [
    "blockId", "blockerId", "targetId", "matchId", "createdAt", "status"
  ],
  REPORTS: [
    "reportId", "reporterId", "targetId", "matchId", "category", "details",
    "createdAt", "status", "moderatorNote"
  ],
  SHARDS: [
    "type", "spreadsheetId", "sheetName", "rowCount", "sequence", "status", "createdAt"
  ],
  AUDIT: [
    "eventId", "userId", "eventType", "metadataJson", "createdAt"
  ]
});

const SHARD_SCHEMAS = Object.freeze({
  SWIPES: ["swipeId", "swiperId", "targetId", "decision", "createdAt"],
  CHAT: ["messageId", "matchId", "senderId", "text", "sentAt"]
});

function setupProject() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("MASTER_SPREADSHEET_ID")) {
    throw new Error("Project is already configured. Delete Script Properties only if you intentionally want a new datastore.");
  }

  const rootFolder = DriveApp.createFolder("IITI Spark Data");
  const photoFolder = rootFolder.createFolder("Profile Photos");
  const master = SpreadsheetApp.create("IITI Spark — Master Database");
  DriveApp.getFileById(master.getId()).moveTo(rootFolder);

  const first = master.getSheets()[0];
  first.setName("USERS");
  initializeSheet_(first, CORE_SHEETS.USERS);

  Object.keys(CORE_SHEETS).filter(name => name !== "USERS").forEach(name => {
    const sheet = master.insertSheet(name);
    initializeSheet_(sheet, CORE_SHEETS[name]);
  });

  props.setProperties({
    MASTER_SPREADSHEET_ID: master.getId(),
    DATA_FOLDER_ID: rootFolder.getId(),
    PHOTO_FOLDER_ID: photoFolder.getId(),
    WEB_CLIENT_ID: "PASTE_GOOGLE_WEB_CLIENT_ID_HERE.apps.googleusercontent.com",
    ALLOWED_DOMAIN: "iiti.ac.in",
    TERMS_VERSION: "2026-07-21",
    APP_NAME: "IITI Spark",
    SESSION_HOURS: "168",
    MAX_ROWS_PER_SHARD: "40000",
    MAX_CELLS_PER_WORKBOOK: "8000000",
    ALLOW_PUBLIC_PHOTO_UPLOAD: "false",
    ALLOWED_WEB_ORIGINS: "http://localhost:5500"
  }, true);

  appendAudit_("SYSTEM", "SETUP_COMPLETED", {
    masterSpreadsheetId: master.getId(),
    dataFolderId: rootFolder.getId()
  });

  console.log("Master spreadsheet: " + master.getUrl());
  console.log("Data folder: " + rootFolder.getUrl());
  console.log("Next: run configureApp(yourWebClientId, 'iiti.ac.in', ['http://localhost:5500', 'https://YOUR_USERNAME.github.io']).");
  return {
    masterSpreadsheetUrl: master.getUrl(),
    dataFolderUrl: rootFolder.getUrl()
  };
}

function configureApp(webClientId, allowedDomain, allowedWebOrigins) {
  if (!webClientId || !/\.apps\.googleusercontent\.com$/.test(String(webClientId))) {
    throw new Error("Provide a valid Google OAuth Web Client ID.");
  }
  const domain = String(allowedDomain || "iiti.ac.in").toLowerCase().trim();
  const origins = Array.isArray(allowedWebOrigins)
    ? allowedWebOrigins
    : String(allowedWebOrigins || "http://localhost:5500").split(",");
  const cleanedOrigins = origins.map(origin => String(origin).trim().replace(/\/$/, ""))
    .filter(origin => /^https?:\/\//.test(origin));
  if (!cleanedOrigins.length) throw new Error("Provide at least one allowed web origin.");
  PropertiesService.getScriptProperties().setProperties({
    WEB_CLIENT_ID: String(webClientId).trim(),
    ALLOWED_DOMAIN: domain,
    ALLOWED_WEB_ORIGINS: cleanedOrigins.join(",")
  });
  return { configured: true, allowedDomain: domain, allowedWebOrigins: cleanedOrigins };
}

function enablePublicPhotoUploads() {
  PropertiesService.getScriptProperties().setProperty("ALLOW_PUBLIC_PHOTO_UPLOAD", "true");
  return "Enabled. Uploaded files will use link-accessible Drive sharing. Review the privacy warning first.";
}

function disablePublicPhotoUploads() {
  PropertiesService.getScriptProperties().setProperty("ALLOW_PUBLIC_PHOTO_UPLOAD", "false");
  return "Disabled. Users can continue using their Google profile photo or an approved HTTPS image URL.";
}

function getAppConfig_() {
  const p = PropertiesService.getScriptProperties().getProperties();
  const required = ["MASTER_SPREADSHEET_ID", "DATA_FOLDER_ID", "PHOTO_FOLDER_ID", "WEB_CLIENT_ID", "ALLOWED_DOMAIN", "ALLOWED_WEB_ORIGINS"];
  const missing = required.filter(key => !p[key]);
  if (missing.length) throw new Error("Backend is not configured. Missing Script Properties: " + missing.join(", "));
  return {
    masterSpreadsheetId: p.MASTER_SPREADSHEET_ID,
    dataFolderId: p.DATA_FOLDER_ID,
    photoFolderId: p.PHOTO_FOLDER_ID,
    webClientId: p.WEB_CLIENT_ID,
    allowedDomain: p.ALLOWED_DOMAIN.toLowerCase(),
    termsVersion: p.TERMS_VERSION || "2026-07-21",
    appName: p.APP_NAME || "IITI Spark",
    sessionHours: Number(p.SESSION_HOURS || 168),
    maxRowsPerShard: Number(p.MAX_ROWS_PER_SHARD || 40000),
    maxCellsPerWorkbook: Number(p.MAX_CELLS_PER_WORKBOOK || 8000000),
    allowPublicPhotoUpload: String(p.ALLOW_PUBLIC_PHOTO_UPLOAD).toLowerCase() === "true",
    allowedWebOrigins: String(p.ALLOWED_WEB_ORIGINS || "").split(",").map(origin => origin.trim()).filter(Boolean)
  };
}

function initializeSheet_(sheet, headers) {
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setBackground("#171125")
    .setFontColor("#F8F5FF");
  if (sheet.getMaxColumns() > headers.length) {
    sheet.deleteColumns(headers.length + 1, sheet.getMaxColumns() - headers.length);
  }
  if (sheet.getMaxRows() > 1000) {
    sheet.deleteRows(1001, sheet.getMaxRows() - 1000);
  }
}
