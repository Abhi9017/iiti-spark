/**
 * IITI Spark Google Apps Script backend.
 * This is a campus-pilot architecture, not a production-scale dating platform.
 * Chats are NOT end-to-end encrypted.
 */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "health";
  if (action === "bridge") return bridgeHtml_();
  if (action !== "health") return json_({ ok: false, error: "Unknown GET action." });
  try {
    const cfg = getAppConfig_();
    return json_({
      ok: true,
      data: {
        service: cfg.appName,
        status: "online",
        allowedDomain: cfg.allowedDomain,
        termsVersion: cfg.termsVersion,
        endToEndEncrypted: false,
        timestamp: nowIso_()
      }
    });
  } catch (error) {
    return json_({ ok: false, error: safeError_(error) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error("Missing request body.");
    return json_(handleApiRequest_(JSON.parse(e.postData.contents)));
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return json_({ ok: false, error: safeError_(error) });
  }
}

/** Called by the sandboxed Apps Script bridge iframe through google.script.run. */
function apiBridge(request) {
  return handleApiRequest_(request || {});
}

function handleApiRequest_(request) {
  try {
    const action = String(request.action || "");
    const payload = request.payload || {};
    const sessionToken = String(request.sessionToken || "");
    const routes = {
      login: () => login_(payload),
      getMe: () => getMe_(sessionToken),
      saveProfile: () => saveProfile_(sessionToken, payload),
      setDiscovery: () => setDiscovery_(sessionToken, payload),
      uploadPhoto: () => uploadPhoto_(sessionToken, payload),
      discover: () => discover_(sessionToken, payload),
      swipe: () => swipe_(sessionToken, payload),
      matches: () => matches_(sessionToken),
      messages: () => messages_(sessionToken, payload),
      sendMessage: () => sendMessage_(sessionToken, payload),
      report: () => report_(sessionToken, payload),
      block: () => block_(sessionToken, payload),
      logout: () => logout_(sessionToken),
      deleteAccount: () => deleteAccount_(sessionToken, payload)
    };
    if (!routes[action]) throw new Error("Unknown API action.");
    return { ok: true, data: routes[action]() };
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return { ok: false, error: safeError_(error) };
  }
}

function bridgeHtml_() {
  const cfg = getAppConfig_();
  const allowedOrigins = cfg.allowedWebOrigins;
  const serializedOrigins = JSON.stringify(allowedOrigins).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html><head><base target="_top"><meta charset="utf-8"></head>
<body><script>
(function () {
  "use strict";
  const allowedOrigins = ${serializedOrigins};
  function isAllowed(origin) { return allowedOrigins.indexOf(origin) !== -1; }
  window.addEventListener("message", function (event) {
    const data = event.data || {};
    if (!isAllowed(event.origin) || data.type !== "IITI_SPARK_API_REQUEST" || !data.requestId) return;
    google.script.run
      .withSuccessHandler(function (result) {
        event.source.postMessage({ type: "IITI_SPARK_API_RESPONSE", requestId: data.requestId, result: result }, event.origin);
      })
      .withFailureHandler(function (error) {
        event.source.postMessage({ type: "IITI_SPARK_API_RESPONSE", requestId: data.requestId, result: { ok: false, error: String(error && error.message || error || "Bridge error") } }, event.origin);
      })
      .apiBridge(data.request || {});
  });
  parent.postMessage({ type: "IITI_SPARK_BRIDGE_READY" }, "*");
})();
</script></body></html>`;
  return HtmlService.createHtmlOutput(html)
    .setTitle(cfg.appName + " API Bridge")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function login_(payload) {
  const cfg = getAppConfig_();
  if (payload.acceptedTerms !== true || payload.ageConfirmed !== true) {
    throw new Error("Age confirmation and Terms acceptance are required.");
  }
  const termsVersion = cleanText_(payload.termsVersion, 40);
  if (termsVersion !== cfg.termsVersion) throw new Error("The Terms version is outdated. Refresh the website and review the current terms.");

  const identity = verifyGoogleToken_(String(payload.credential || ""), cfg);
  const now = nowIso_();
  let user = findRecord_("USERS", "userId", identity.sub);

  withScriptLock_(() => {
    user = findRecord_("USERS", "userId", identity.sub);
    if (!user) {
      appendRecord_("USERS", {
        userId: identity.sub,
        email: identity.email.toLowerCase(),
        googleName: cleanText_(identity.name || "", 100),
        displayName: cleanText_(identity.name || "", 40),
        photoUrl: isSafeHttpsUrl_(identity.picture) ? identity.picture : "",
        program: "",
        year: "",
        gender: "",
        lookingFor: "",
        bio: "",
        interestsJson: "[]",
        allowDiscovery: false,
        ageConfirmed: true,
        termsVersion: termsVersion,
        termsAcceptedAt: now,
        profileComplete: false,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now
      });
    } else {
      if (user.status === "DELETED" || user.status === "BANNED") {
        throw new Error("This account is not eligible to use the service.");
      }
      updateRecord_("USERS", user._row, {
        email: identity.email.toLowerCase(),
        googleName: cleanText_(identity.name || user.googleName, 100),
        termsVersion: termsVersion,
        termsAcceptedAt: now,
        ageConfirmed: true,
        updatedAt: now,
        lastSeenAt: now
      });
    }
  });

  user = findRecord_("USERS", "userId", identity.sub);
  const sessionToken = createSession_(identity.sub, cfg.sessionHours);
  appendAudit_(identity.sub, "LOGIN", { termsVersion: termsVersion });
  return {
    sessionToken: sessionToken,
    user: clientUser_(user),
    needsProfile: !toBool_(user.profileComplete)
  };
}

function getMe_(sessionToken) {
  const auth = authenticate_(sessionToken);
  return { user: clientUser_(auth.user), needsProfile: !toBool_(auth.user.profileComplete) };
}

function saveProfile_(sessionToken, payload) {
  const auth = authenticate_(sessionToken);
  enforceRate_(auth.user.userId, "saveProfile", 20, 60);

  const displayName = cleanText_(payload.displayName, 40);
  const program = cleanText_(payload.program, 30);
  const year = cleanText_(payload.year, 10);
  const gender = cleanText_(payload.gender || "", 40);
  const lookingFor = cleanText_(payload.lookingFor, 80);
  const bio = cleanText_(payload.bio, 280);
  const interests = normalizeInterests_(payload.interests);
  const photoUrl = cleanText_(payload.photoUrl || "", 1000);
  const allowDiscovery = payload.allowDiscovery !== false;

  if (displayName.length < 2) throw new Error("Display name must contain at least two characters.");
  if (!program || !year || !lookingFor || bio.length < 10) throw new Error("Complete programme, year, connection preference, and a meaningful bio.");
  if (interests.length < 3 || interests.length > 12) throw new Error("Choose between 3 and 12 interests.");
  if (photoUrl && !isSafeImageUrl_(photoUrl)) throw new Error("Photo URL must be a safe HTTPS or image data URL.");

  const now = nowIso_();
  withScriptLock_(() => {
    updateRecord_("USERS", auth.user._row, {
      displayName: displayName,
      photoUrl: photoUrl,
      program: program,
      year: year,
      gender: gender,
      lookingFor: lookingFor,
      bio: bio,
      interestsJson: JSON.stringify(interests),
      allowDiscovery: allowDiscovery,
      profileComplete: true,
      status: "ACTIVE",
      updatedAt: now,
      lastSeenAt: now
    });
  });
  appendAudit_(auth.user.userId, "PROFILE_SAVED", { allowDiscovery: allowDiscovery });
  return { user: clientUser_(findRecord_("USERS", "userId", auth.user.userId)) };
}

function setDiscovery_(sessionToken, payload) {
  const auth = authenticate_(sessionToken);
  const allowDiscovery = payload.allowDiscovery === true;
  updateRecord_("USERS", auth.user._row, { allowDiscovery: allowDiscovery, updatedAt: nowIso_() });
  appendAudit_(auth.user.userId, "DISCOVERY_CHANGED", { allowDiscovery: allowDiscovery });
  return { user: clientUser_(findRecord_("USERS", "userId", auth.user.userId)) };
}

function uploadPhoto_(sessionToken, payload) {
  const auth = authenticate_(sessionToken);
  const cfg = getAppConfig_();
  enforceRate_(auth.user.userId, "uploadPhoto", 5, 300);
  if (!cfg.allowPublicPhotoUpload) {
    throw new Error("Custom Drive photo uploads are disabled by the operator. Use your Google profile photo or ask the operator to enable the documented link-sharing mode.");
  }

  const dataUrl = String(payload.dataUrl || "");
  const match = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Invalid image format. Use JPG, PNG, or WebP.");
  const bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > 1.5 * 1024 * 1024) throw new Error("Photo must be smaller than 1.5 MB.");

  const mime = match[1] === "jpeg" ? "image/jpeg" : "image/" + match[1];
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const blob = Utilities.newBlob(bytes, mime, "profile_" + auth.user.userId + "_" + Date.now() + "." + ext);
  const file = DriveApp.getFolderById(cfg.photoFolderId).createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (error) {
    file.setTrashed(true);
    throw new Error("The Google Workspace administrator blocked link-accessible Drive sharing. Keep uploads disabled and use Google profile photos, or migrate photos to a private storage service.");
  }
  const photoUrl = "https://drive.google.com/thumbnail?id=" + encodeURIComponent(file.getId()) + "&sz=w1200";
  appendAudit_(auth.user.userId, "PHOTO_UPLOADED", { fileId: file.getId() });
  return { photoUrl: photoUrl };
}

function discover_(sessionToken, payload) {
  const auth = authenticate_(sessionToken);
  enforceRate_(auth.user.userId, "discover", 60, 60);
  const limit = clamp_(Number(payload.limit || 20), 1, 50);
  const users = getAllRecords_("USERS");
  const swiped = getSwipedTargets_(auth.user.userId);
  const blocked = getBlockedUserIds_(auth.user.userId);

  const candidates = users.filter(user => {
    return user.userId !== auth.user.userId &&
      user.status === "ACTIVE" &&
      toBool_(user.profileComplete) &&
      toBool_(user.allowDiscovery) &&
      !swiped.has(user.userId) &&
      !blocked.has(user.userId);
  });

  shuffle_(candidates);
  return { profiles: candidates.slice(0, limit).map(publicProfile_) };
}

function swipe_(sessionToken, payload) {
  const auth = authenticate_(sessionToken);
  enforceRate_(auth.user.userId, "swipe", 120, 60);
  const targetUserId = cleanText_(payload.targetUserId, 100);
  const decision = cleanText_(payload.decision, 10).toUpperCase();
  if (!targetUserId || targetUserId === auth.user.userId) throw new Error("Invalid target profile.");
  if (!["LIKE", "PASS"].includes(decision)) throw new Error("Swipe decision must be LIKE or PASS.");
  const target = findRecord_("USERS", "userId", targetUserId);
  if (!target || target.status !== "ACTIVE" || !toBool_(target.profileComplete)) throw new Error("This profile is unavailable.");
  if (getBlockedUserIds_(auth.user.userId).has(targetUserId)) throw new Error("This interaction is unavailable.");
  if (getSwipedTargets_(auth.user.userId).has(targetUserId)) throw new Error("You already responded to this profile.");

  let result = { matched: false };
  withScriptLock_(() => {
    appendToShard_("SWIPES", {
      swipeId: id_("sw"),
      swiperId: auth.user.userId,
      targetId: targetUserId,
      decision: decision,
      createdAt: nowIso_()
    });

    if (decision === "LIKE") {
      upsertLike_(auth.user.userId, targetUserId, "ACTIVE");
      const reverse = findRecord_("LIKES_INDEX", "key", likeKey_(targetUserId, auth.user.userId));
      if (reverse && reverse.status === "ACTIVE") {
        const match = ensureMatch_(auth.user.userId, targetUserId);
        result = {
          matched: true,
          match: clientMatchFor_(match, auth.user.userId),
          otherProfile: publicProfile_(target)
        };
      }
    }
  });

  appendAudit_(auth.user.userId, "SWIPE", { targetUserId: targetUserId, decision: decision, matched: result.matched });
  return result;
}

function matches_(sessionToken) {
  const auth = authenticate_(sessionToken);
  const blocked = getBlockedUserIds_(auth.user.userId);
  const rows = getAllRecords_("MATCHES")
    .filter(match => match.status === "ACTIVE" && (match.userA === auth.user.userId || match.userB === auth.user.userId))
    .filter(match => !blocked.has(match.userA === auth.user.userId ? match.userB : match.userA))
    .sort((a, b) => String(b.lastMessageAt || b.createdAt).localeCompare(String(a.lastMessageAt || a.createdAt)));

  const data = rows.map(match => {
    const otherId = match.userA === auth.user.userId ? match.userB : match.userA;
    const other = findRecord_("USERS", "userId", otherId);
    return {
      matchId: match.matchId,
      otherUserId: otherId,
      createdAt: match.createdAt,
      lastMessageAt: match.lastMessageAt || "",
      lastMessage: match.lastMessagePreview || "",
      profile: other ? publicProfile_(other) : { userId: otherId, displayName: "Unavailable profile", interests: [] }
    };
  });
  return { matches: data };
}

function messages_(sessionToken, payload) {
  const auth = authenticate_(sessionToken);
  enforceRate_(auth.user.userId, "messages", 90, 60);
  const matchId = cleanText_(payload.matchId, 100);
  const match = requireActiveMatch_(matchId, auth.user.userId);
  const otherId = match.userA === auth.user.userId ? match.userB : match.userA;
  if (getBlockedUserIds_(auth.user.userId).has(otherId)) throw new Error("Messaging is unavailable for this match.");

  const after = cleanText_(payload.after || "", 40);
  const limit = clamp_(Number(payload.limit || 200), 1, 500);
  const records = readAllShardRecords_("CHAT")
    .filter(message => message.matchId === matchId && (!after || String(message.sentAt) > after))
    .sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)))
    .slice(-limit)
    .map(message => ({
      messageId: message.messageId,
      senderId: message.senderId,
      text: message.text,
      sentAt: message.sentAt
    }));
  return { messages: records };
}

function sendMessage_(sessionToken, payload) {
  const auth = authenticate_(sessionToken);
  enforceRate_(auth.user.userId, "sendMessage", 30, 60);
  const matchId = cleanText_(payload.matchId, 100);
  const text = cleanMessage_(payload.text, 1000);
  if (!text) throw new Error("Message cannot be empty.");
  const match = requireActiveMatch_(matchId, auth.user.userId);
  const otherId = match.userA === auth.user.userId ? match.userB : match.userA;
  if (getBlockedUserIds_(auth.user.userId).has(otherId)) throw new Error("Messaging is unavailable for this match.");

  const message = {
    messageId: id_("msg"),
    matchId: matchId,
    senderId: auth.user.userId,
    text: text,
    sentAt: nowIso_()
  };

  withScriptLock_(() => {
    appendToShard_("CHAT", message);
    updateRecord_("MATCHES", match._row, {
      lastMessageAt: message.sentAt,
      lastMessagePreview: text.slice(0, 120)
    });
  });
  return { message: message };
}

function report_(sessionToken, payload) {
  const auth = authenticate_(sessionToken);
  enforceRate_(auth.user.userId, "report", 8, 3600);
  const targetUserId = cleanText_(payload.targetUserId, 100);
  const matchId = cleanText_(payload.matchId || "", 100);
  const category = cleanText_(payload.category, 80);
  const details = cleanText_(payload.details, 1000);
  if (!targetUserId || targetUserId === auth.user.userId || !category || details.length < 5) {
    throw new Error("Provide a valid report reason and factual details.");
  }
  if (matchId) requireMatchMembership_(matchId, auth.user.userId);

  appendRecord_("REPORTS", {
    reportId: id_("rep"),
    reporterId: auth.user.userId,
    targetId: targetUserId,
    matchId: matchId,
    category: category,
    details: details,
    createdAt: nowIso_(),
    status: "OPEN",
    moderatorNote: ""
  });
  appendAudit_(auth.user.userId, "REPORT_SUBMITTED", { targetUserId: targetUserId, matchId: matchId, category: category });
  return { submitted: true };
}

function block_(sessionToken, payload) {
  const auth = authenticate_(sessionToken);
  enforceRate_(auth.user.userId, "block", 30, 3600);
  const targetUserId = cleanText_(payload.targetUserId, 100);
  const matchId = cleanText_(payload.matchId || "", 100);
  if (!targetUserId || targetUserId === auth.user.userId) throw new Error("Invalid block target.");

  withScriptLock_(() => {
    const existing = getAllRecords_("BLOCKS").find(row => row.blockerId === auth.user.userId && row.targetId === targetUserId && row.status === "ACTIVE");
    if (!existing) {
      appendRecord_("BLOCKS", {
        blockId: id_("blk"),
        blockerId: auth.user.userId,
        targetId: targetUserId,
        matchId: matchId,
        createdAt: nowIso_(),
        status: "ACTIVE"
      });
    }
    if (matchId) {
      const match = requireMatchMembership_(matchId, auth.user.userId);
      updateRecord_("MATCHES", match._row, { status: "BLOCKED", blockedBy: auth.user.userId });
    }
    upsertLike_(auth.user.userId, targetUserId, "REVOKED");
  });
  appendAudit_(auth.user.userId, "USER_BLOCKED", { targetUserId: targetUserId, matchId: matchId });
  return { blocked: true };
}

function logout_(sessionToken) {
  if (!sessionToken) return { signedOut: true };
  const hash = hash_(sessionToken);
  const session = findRecord_("SESSIONS", "sessionHash", hash);
  if (session) updateRecord_("SESSIONS", session._row, { status: "REVOKED", lastSeenAt: nowIso_() });
  return { signedOut: true };
}

function deleteAccount_(sessionToken, payload) {
  const auth = authenticate_(sessionToken);
  if (payload.confirmation !== "DELETE") throw new Error("Deletion confirmation is required.");
  const now = nowIso_();
  withScriptLock_(() => {
    updateRecord_("USERS", auth.user._row, {
      email: "",
      googleName: "",
      displayName: "Deleted user",
      photoUrl: "",
      program: "",
      year: "",
      gender: "",
      lookingFor: "",
      bio: "",
      interestsJson: "[]",
      allowDiscovery: false,
      profileComplete: false,
      status: "DELETED",
      updatedAt: now,
      lastSeenAt: now
    });
    getAllRecords_("SESSIONS")
      .filter(session => session.userId === auth.user.userId && session.status === "ACTIVE")
      .forEach(session => updateRecord_("SESSIONS", session._row, { status: "REVOKED" }));
  });
  appendAudit_(auth.user.userId, "ACCOUNT_ANONYMIZED", {});
  return { deleted: true };
}

function verifyGoogleToken_(credential, cfg) {
  if (!credential || credential.length < 100) throw new Error("Missing Google identity credential.");
  const url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, method: "get" });
  if (response.getResponseCode() !== 200) throw new Error("Google could not verify this sign-in token.");
  const token = JSON.parse(response.getContentText());
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (token.aud !== cfg.webClientId) throw new Error("Google token audience does not match this application.");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(token.iss)) throw new Error("Invalid Google token issuer.");
  if (Number(token.exp || 0) <= nowSeconds) throw new Error("Google sign-in token expired. Sign in again.");
  if (String(token.email_verified).toLowerCase() !== "true") throw new Error("Google email is not verified.");
  if (String(token.hd || "").toLowerCase() !== cfg.allowedDomain) throw new Error("Use an active @" + cfg.allowedDomain + " Google Workspace account.");
  if (!String(token.email || "").toLowerCase().endsWith("@" + cfg.allowedDomain)) throw new Error("Institute email domain is not eligible.");
  if (!token.sub) throw new Error("Google account identifier is missing.");
  return token;
}

function createSession_(userId, hours) {
  const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  const now = new Date();
  const expires = new Date(now.getTime() + Number(hours || 168) * 3600 * 1000);
  appendRecord_("SESSIONS", {
    sessionHash: hash_(token),
    userId: userId,
    expiresAt: expires.toISOString(),
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    status: "ACTIVE"
  });
  return token;
}

function authenticate_(sessionToken) {
  if (!sessionToken || sessionToken.length < 40) throw new Error("Sign in is required.");
  const session = findRecord_("SESSIONS", "sessionHash", hash_(sessionToken));
  if (!session || session.status !== "ACTIVE") throw new Error("Session is invalid or expired.");
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    updateRecord_("SESSIONS", session._row, { status: "EXPIRED" });
    throw new Error("Session expired. Sign in again.");
  }
  const user = findRecord_("USERS", "userId", session.userId);
  if (!user || user.status !== "ACTIVE") throw new Error("Account is unavailable.");
  const now = nowIso_();
  updateRecord_("SESSIONS", session._row, { lastSeenAt: now });
  updateRecord_("USERS", user._row, { lastSeenAt: now });
  return { session: session, user: findRecord_("USERS", "userId", session.userId) };
}

function ensureMatch_(user1, user2) {
  const pair = [user1, user2].sort();
  const matchId = "m_" + shortHash_(pair.join("|"), 28);
  let match = findRecord_("MATCHES", "matchId", matchId);
  if (!match) {
    appendRecord_("MATCHES", {
      matchId: matchId,
      userA: pair[0],
      userB: pair[1],
      status: "ACTIVE",
      createdAt: nowIso_(),
      lastMessageAt: "",
      lastMessagePreview: "",
      blockedBy: ""
    });
    match = findRecord_("MATCHES", "matchId", matchId);
  } else if (match.status !== "ACTIVE") {
    throw new Error("This match is unavailable.");
  }
  return match;
}

function requireMatchMembership_(matchId, userId) {
  const match = findRecord_("MATCHES", "matchId", matchId);
  if (!match || (match.userA !== userId && match.userB !== userId)) throw new Error("Match not found.");
  return match;
}

function requireActiveMatch_(matchId, userId) {
  const match = requireMatchMembership_(matchId, userId);
  if (match.status !== "ACTIVE") throw new Error("This match is no longer active.");
  return match;
}

function upsertLike_(likerId, likedId, status) {
  const key = likeKey_(likerId, likedId);
  const existing = findRecord_("LIKES_INDEX", "key", key);
  const now = nowIso_();
  if (existing) {
    updateRecord_("LIKES_INDEX", existing._row, { status: status, updatedAt: now });
  } else {
    appendRecord_("LIKES_INDEX", {
      key: key,
      likerId: likerId,
      likedId: likedId,
      status: status,
      createdAt: now,
      updatedAt: now
    });
  }
}

function likeKey_(likerId, likedId) {
  return shortHash_(likerId + "|" + likedId, 36);
}

function getSwipedTargets_(userId) {
  const result = new Set();
  readAllShardRecords_("SWIPES").forEach(row => {
    if (row.swiperId === userId) result.add(row.targetId);
  });
  return result;
}

function getBlockedUserIds_(userId) {
  const result = new Set();
  getAllRecords_("BLOCKS").forEach(row => {
    if (row.status !== "ACTIVE") return;
    if (row.blockerId === userId) result.add(row.targetId);
    if (row.targetId === userId) result.add(row.blockerId);
  });
  return result;
}

function appendToShard_(type, record) {
  const schema = SHARD_SCHEMAS[type];
  if (!schema) throw new Error("Unknown shard type.");
  let shard = getActiveShard_(type);
  const cfg = getAppConfig_();
  if (!shard || Number(shard.rowCount || 0) >= cfg.maxRowsPerShard) {
    if (shard) updateRecord_("SHARDS", shard._row, { status: "FULL" });
    shard = createShard_(type, schema);
  }

  const ss = SpreadsheetApp.openById(shard.spreadsheetId);
  const sheet = ss.getSheetByName(shard.sheetName);
  if (!sheet) throw new Error("Shard sheet is missing: " + shard.sheetName);
  const values = schema.map(key => record[key] === undefined ? "" : record[key]);
  sheet.appendRow(values);
  const newCount = Number(shard.rowCount || 0) + 1;
  updateRecord_("SHARDS", shard._row, { rowCount: newCount });
  return record;
}

function getActiveShard_(type) {
  const rows = getAllRecords_("SHARDS")
    .filter(row => row.type === type && row.status === "ACTIVE")
    .sort((a, b) => Number(b.sequence) - Number(a.sequence));
  return rows[0] || null;
}

function createShard_(type, schema) {
  const cfg = getAppConfig_();
  const existing = getAllRecords_("SHARDS").filter(row => row.type === type);
  const sequence = existing.length ? Math.max.apply(null, existing.map(row => Number(row.sequence || 0))) + 1 : 1;
  const sheetName = type + "_" + String(sequence).padStart(4, "0");
  const spreadsheetId = chooseShardWorkbook_(schema.length, cfg);
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  initializeSheet_(sheet, schema);

  appendRecord_("SHARDS", {
    type: type,
    spreadsheetId: spreadsheetId,
    sheetName: sheetName,
    rowCount: 0,
    sequence: sequence,
    status: "ACTIVE",
    createdAt: nowIso_()
  });
  return findRecord_("SHARDS", "sheetName", sheetName);
}

function chooseShardWorkbook_(columnCount, cfg) {
  const candidateIds = [cfg.masterSpreadsheetId];
  getAllRecords_("SHARDS").forEach(row => {
    if (row.spreadsheetId && !candidateIds.includes(row.spreadsheetId)) candidateIds.push(row.spreadsheetId);
  });
  const estimatedCells = cfg.maxRowsPerShard * columnCount;
  for (let i = candidateIds.length - 1; i >= 0; i--) {
    try {
      const ss = SpreadsheetApp.openById(candidateIds[i]);
      if (countWorkbookCells_(ss) + estimatedCells < cfg.maxCellsPerWorkbook) return ss.getId();
    } catch (error) {
      console.warn("Skipping unavailable shard workbook: " + candidateIds[i]);
    }
  }
  const partNumber = candidateIds.length + 1;
  const ss = SpreadsheetApp.create("IITI Spark — Data Part " + String(partNumber).padStart(3, "0"));
  DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(cfg.dataFolderId));
  const defaultSheet = ss.getSheets()[0];
  defaultSheet.setName("README");
  defaultSheet.getRange("A1").setValue("Managed automatically by IITI Spark. Do not edit shard tabs manually.");
  return ss.getId();
}

function countWorkbookCells_(ss) {
  return ss.getSheets().reduce((total, sheet) => total + sheet.getMaxRows() * sheet.getMaxColumns(), 0);
}

function readAllShardRecords_(type) {
  const schema = SHARD_SCHEMAS[type];
  if (!schema) throw new Error("Unknown shard type.");
  const shards = getAllRecords_("SHARDS")
    .filter(row => row.type === type && ["ACTIVE", "FULL"].includes(row.status))
    .sort((a, b) => Number(a.sequence) - Number(b.sequence));
  const result = [];
  shards.forEach(shard => {
    try {
      const ss = SpreadsheetApp.openById(shard.spreadsheetId);
      const sheet = ss.getSheetByName(shard.sheetName);
      if (!sheet || sheet.getLastRow() < 2) return;
      const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, schema.length).getValues();
      values.forEach(row => {
        const record = {};
        schema.forEach((header, index) => record[header] = normalizeCell_(row[index]));
        result.push(record);
      });
    } catch (error) {
      console.error("Could not read shard " + shard.sheetName + ": " + error.message);
    }
  });
  return result;
}

function clientUser_(record) {
  return {
    userId: record.userId,
    email: record.email,
    googleName: record.googleName,
    displayName: record.displayName,
    photoUrl: record.photoUrl,
    program: record.program,
    year: record.year,
    gender: record.gender,
    lookingFor: record.lookingFor,
    bio: record.bio,
    interests: parseJsonArray_(record.interestsJson),
    allowDiscovery: toBool_(record.allowDiscovery),
    profileComplete: toBool_(record.profileComplete),
    status: record.status
  };
}

function publicProfile_(record) {
  return {
    userId: record.userId,
    displayName: record.displayName,
    photoUrl: record.photoUrl,
    program: record.program,
    year: record.year,
    gender: record.gender,
    lookingFor: record.lookingFor,
    bio: record.bio,
    interests: parseJsonArray_(record.interestsJson)
  };
}

function clientMatchFor_(match, currentUserId) {
  return {
    matchId: match.matchId,
    otherUserId: match.userA === currentUserId ? match.userB : match.userA,
    createdAt: match.createdAt
  };
}

function appendAudit_(userId, eventType, metadata) {
  try {
    appendRecord_("AUDIT", {
      eventId: id_("evt"),
      userId: userId,
      eventType: eventType,
      metadataJson: JSON.stringify(metadata || {}),
      createdAt: nowIso_()
    });
  } catch (error) {
    console.error("Audit write failed: " + error.message);
  }
}

function appendRecord_(sheetName, object) {
  const cfg = getAppConfig_();
  const ss = SpreadsheetApp.openById(cfg.masterSpreadsheetId);
  const sheet = ss.getSheetByName(sheetName);
  const headers = CORE_SHEETS[sheetName];
  if (!sheet || !headers) throw new Error("Core sheet is missing: " + sheetName);
  sheet.appendRow(headers.map(header => object[header] === undefined ? "" : object[header]));
}

function updateRecord_(sheetName, rowNumber, changes) {
  if (!rowNumber || rowNumber < 2) throw new Error("Invalid row update.");
  const cfg = getAppConfig_();
  const ss = SpreadsheetApp.openById(cfg.masterSpreadsheetId);
  const sheet = ss.getSheetByName(sheetName);
  const headers = CORE_SHEETS[sheetName];
  if (!sheet || !headers) throw new Error("Core sheet is missing: " + sheetName);
  const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  Object.keys(changes).forEach(key => {
    const index = headers.indexOf(key);
    if (index >= 0) row[index] = changes[key];
  });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
}

function findRecord_(sheetName, key, value) {
  const records = getAllRecords_(sheetName);
  return records.find(record => String(record[key]) === String(value)) || null;
}

function getAllRecords_(sheetName) {
  const cfg = getAppConfig_();
  const ss = SpreadsheetApp.openById(cfg.masterSpreadsheetId);
  const sheet = ss.getSheetByName(sheetName);
  const headers = CORE_SHEETS[sheetName];
  if (!sheet || !headers) throw new Error("Core sheet is missing: " + sheetName);
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return values.map((row, index) => {
    const record = { _row: index + 2 };
    headers.forEach((header, column) => record[header] = normalizeCell_(row[column]));
    return record;
  });
}

function cleanupExpiredSessions() {
  const now = Date.now();
  let changed = 0;
  getAllRecords_("SESSIONS").forEach(session => {
    if (session.status === "ACTIVE" && new Date(session.expiresAt).getTime() <= now) {
      updateRecord_("SESSIONS", session._row, { status: "EXPIRED" });
      changed++;
    }
  });
  return { expiredSessionsMarked: changed };
}

function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function enforceRate_(userId, action, limit, windowSeconds) {
  const cache = CacheService.getScriptCache();
  const key = "rate:" + shortHash_(userId + ":" + action, 32);
  const count = Number(cache.get(key) || 0) + 1;
  if (count > limit) throw new Error("Too many requests. Please slow down and try again shortly.");
  cache.put(key, String(count), Math.min(windowSeconds, 21600));
}

function json_(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}

function safeError_(error) {
  const message = String(error && error.message ? error.message : error || "Unexpected error.");
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

function normalizeCell_(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function toBool_(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function parseJsonArray_(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeInterests_(value) {
  if (!Array.isArray(value)) return [];
  const unique = [];
  value.forEach(item => {
    const cleaned = cleanText_(item, 40);
    if (cleaned && !unique.includes(cleaned)) unique.push(cleaned);
  });
  return unique;
}

function cleanText_(value, maxLength) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function cleanMessage_(value, maxLength) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function isSafeHttpsUrl_(value) {
  return /^https:\/\//i.test(String(value || ""));
}

function isSafeImageUrl_(value) {
  const text = String(value || "");
  return /^https:\/\//i.test(text) || /^data:image\/(jpeg|png|webp);base64,/i.test(text);
}

function hash_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "");
}

function shortHash_(value, length) {
  return hash_(value).slice(0, length || 24);
}

function id_(prefix) {
  return prefix + "_" + Utilities.getUuid().replace(/-/g, "");
}

function nowIso_() {
  return new Date().toISOString();
}

function clamp_(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function shuffle_(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}
