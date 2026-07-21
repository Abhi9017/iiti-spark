(() => {
  "use strict";

  const CFG = Object.freeze({
    API_URL: "",
    GOOGLE_CLIENT_ID: "",
    ALLOWED_DOMAIN: "iiti.ac.in",
    APP_NAME: "IITI Spark",
    TERMS_VERSION: "2026-07-21",
    DEMO_MODE: false,
    CHAT_POLL_MS: 3000,
    ...(window.IITI_SPARK_CONFIG || {})
  });

  const INTERESTS = [
    "Music", "Movies", "Coding", "Research", "Startups", "Gaming",
    "Photography", "Books", "Fitness", "Cricket", "Badminton", "Football",
    "Dance", "Food", "Travel", "Art", "Anime", "Nature", "Flute", "Chess",
    "Volunteering", "Night walks", "Coffee", "Deep conversations"
  ];

  const state = {
    sessionToken: sessionStorage.getItem("iitiSparkSession") || "",
    user: null,
    googlePhoto: "",
    pendingPhotoDataUrl: "",
    cards: [],
    matches: [],
    activeMatch: null,
    messages: [],
    chatTimer: null,
    lastMessageAt: "",
    swipeBusy: false,
    demo: false,
    bridgeFrame: null,
    bridgeOrigin: "",
    bridgeReadyPromise: null,
    bridgeReadyResolve: null,
    bridgePending: new Map()
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  document.addEventListener("DOMContentLoaded", boot);

  function boot() {
    bindModals();
    bindNavigation();
    bindAuth();
    bindProfile();
    bindDiscovery();
    bindMatches();
    bindChat();
    bindSettings();
    renderInterestOptions();
    if (hasBackendConfig()) initializeApiBridge();

    if (state.sessionToken && hasBackendConfig()) {
      restoreSession();
    } else {
      showScreen("auth");
      initializeGoogleWhenReady();
    }
  }

  function hasBackendConfig() {
    return /^https:\/\/script\.google\.com\//.test(CFG.API_URL) &&
      /\.apps\.googleusercontent\.com$/.test(CFG.GOOGLE_CLIENT_ID);
  }

  function bindModals() {
    $$('[data-open-modal]').forEach(button => {
      button.addEventListener("click", () => openModal(button.dataset.openModal));
    });
    $$('[data-close-modal]').forEach(button => {
      button.addEventListener("click", () => closeModal(button.dataset.closeModal));
    });
    $$('dialog').forEach(dialog => {
      dialog.addEventListener("click", event => {
        if (event.target === dialog) dialog.close();
      });
    });
  }

  function openModal(id) {
    const dialog = document.getElementById(id);
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeModal(id) {
    const dialog = document.getElementById(id);
    if (dialog?.open) dialog.close();
  }

  function bindAuth() {
    $("#demo-login").addEventListener("click", enterDemo);
  }

  function initializeGoogleWhenReady(attempt = 0) {
    if (window.google?.accounts?.id) {
      renderGoogleButton();
      return;
    }
    if (attempt < 40) {
      setTimeout(() => initializeGoogleWhenReady(attempt + 1), 200);
    } else {
      setStatus("auth-status", "Google Sign-In could not load. Check your connection and Content Security Policy.", "error");
    }
  }

  function renderGoogleButton() {
    const container = $("#google-button");
    container.textContent = "";

    if (!hasBackendConfig()) {
      setStatus("auth-status", "Configure config.js before using real sign-in.", "error");
      if (CFG.DEMO_MODE) $("#demo-login").classList.remove("hidden");
      return;
    }

    window.google.accounts.id.initialize({
      client_id: CFG.GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
      hd: CFG.ALLOWED_DOMAIN,
      auto_select: false,
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true
    });

    window.google.accounts.id.renderButton(container, {
      type: "standard",
      theme: "filled_black",
      size: "large",
      shape: "pill",
      text: "continue_with",
      logo_alignment: "left",
      width: 300
    });

    if (CFG.DEMO_MODE) $("#demo-login").classList.remove("hidden");
  }

  async function handleGoogleCredential(response) {
    if (!$("#age-check").checked || !$("#terms-check").checked) {
      setStatus("auth-status", "Confirm age eligibility and accept the Terms and Privacy Notice first.", "error");
      return;
    }
    if (!response?.credential) {
      setStatus("auth-status", "Google did not return an identity credential.", "error");
      return;
    }

    setStatus("auth-status", "Verifying your IIT Indore account…");
    try {
      const data = await api("login", {
        credential: response.credential,
        acceptedTerms: true,
        ageConfirmed: true,
        termsVersion: CFG.TERMS_VERSION
      }, false);

      state.sessionToken = data.sessionToken;
      state.user = data.user;
      state.googlePhoto = data.user.photoUrl || "";
      sessionStorage.setItem("iitiSparkSession", state.sessionToken);

      if (data.needsProfile) {
        populateProfileForm(state.user);
        showScreen("onboarding");
      } else {
        enterMain();
      }
    } catch (error) {
      setStatus("auth-status", error.message, "error");
    }
  }

  async function restoreSession() {
    setStatus("auth-status", "Restoring your session…");
    try {
      const data = await api("getMe", {});
      state.user = data.user;
      state.googlePhoto = data.user.photoUrl || "";
      if (data.needsProfile) {
        populateProfileForm(state.user);
        showScreen("onboarding");
      } else {
        enterMain();
      }
    } catch (error) {
      clearSession();
      showScreen("auth");
      initializeGoogleWhenReady();
      setStatus("auth-status", "Your session expired. Please sign in again.", "error");
    }
  }

  function enterDemo() {
    state.demo = true;
    state.user = {
      userId: "demo-self",
      email: "preview@iiti.ac.in",
      displayName: "Abhi",
      photoUrl: "",
      program: "Ph.D.",
      year: "2",
      bio: "Building things, learning music, and always up for a thoughtful campus conversation.",
      interests: ["Research", "Coding", "Flute", "Coffee"],
      lookingFor: "People for meaningful connections",
      allowDiscovery: true,
      profileComplete: true
    };
    state.cards = demoProfiles();
    state.matches = [];
    enterMain();
    toast("Interface preview enabled. No data will be saved.");
  }

  function showScreen(name) {
    $$(".screen").forEach(screen => screen.classList.remove("active"));
    $(`#screen-${name}`)?.classList.add("active");
  }

  function enterMain() {
    showScreen("main");
    updateCurrentUserUI();
    navigate("discover");
    loadDiscover();
  }

  function bindNavigation() {
    $$('[data-nav]').forEach(button => {
      button.addEventListener("click", () => navigate(button.dataset.nav));
    });
    $("#profile-menu-button").addEventListener("click", () => navigate("settings"));
  }

  function navigate(view) {
    if (view !== "chat") stopChatPolling();
    $$(".app-view").forEach(item => item.classList.remove("active"));
    $(`#view-${view}`)?.classList.add("active");
    $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.nav === view));

    if (view === "matches") loadMatches();
    if (view === "settings") updateCurrentUserUI();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function bindProfile() {
    $("#bio").addEventListener("input", event => {
      $("#bio-count").textContent = event.target.value.length;
    });
    $("#photo-file").addEventListener("change", handlePhotoSelection);
    $("#use-google-photo").addEventListener("click", () => {
      state.pendingPhotoDataUrl = "";
      setAvatar($("#profile-photo-preview"), state.googlePhoto, state.user?.displayName || "?");
    });
    $("#profile-form").addEventListener("submit", saveProfile);
    $("#logout-onboarding").addEventListener("click", logout);
  }

  function renderInterestOptions() {
    const root = $("#interest-options");
    root.textContent = "";
    INTERESTS.forEach(interest => {
      const label = document.createElement("label");
      label.className = "interest-chip";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "interest";
      input.value = interest;
      const span = document.createElement("span");
      span.textContent = interest;
      label.append(input, span);
      root.append(label);
    });
  }

  function populateProfileForm(user = {}) {
    $("#display-name").value = user.displayName || user.googleName || "";
    $("#program").value = user.program || "";
    $("#year").value = user.year || "";
    $("#gender").value = user.gender || "";
    $("#looking-for").value = user.lookingFor || "";
    $("#bio").value = user.bio || "";
    $("#bio-count").textContent = (user.bio || "").length;
    $("#allow-discovery").checked = user.allowDiscovery !== false;
    setAvatar($("#profile-photo-preview"), user.photoUrl || state.googlePhoto, user.displayName || user.googleName || "?");
    const selected = new Set(user.interests || []);
    $$('input[name="interest"]').forEach(input => input.checked = selected.has(input.value));
  }

  async function handlePhotoSelection(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast("Use a JPG, PNG, or WebP image.", "error");
      event.target.value = "";
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      toast("Photo must be smaller than 1.5 MB.", "error");
      event.target.value = "";
      return;
    }
    state.pendingPhotoDataUrl = await readFileAsDataUrl(file);
    setAvatar($("#profile-photo-preview"), state.pendingPhotoDataUrl, "Photo");
  }

  async function saveProfile(event) {
    event.preventDefault();
    const interests = $$('input[name="interest"]:checked').map(input => input.value);
    if (interests.length < 3) {
      setStatus("profile-status", "Choose at least three interests.", "error");
      return;
    }

    const submit = event.submitter;
    if (submit) submit.disabled = true;
    setStatus("profile-status", "Saving your profile…");

    try {
      let photoUrl = state.user?.photoUrl || state.googlePhoto || "";
      if (state.pendingPhotoDataUrl) {
        if (state.demo) {
          photoUrl = state.pendingPhotoDataUrl;
        } else {
          const uploaded = await api("uploadPhoto", { dataUrl: state.pendingPhotoDataUrl });
          photoUrl = uploaded.photoUrl;
        }
      }

      const profile = {
        displayName: $("#display-name").value.trim(),
        program: $("#program").value,
        year: $("#year").value,
        gender: $("#gender").value,
        lookingFor: $("#looking-for").value,
        bio: $("#bio").value.trim(),
        interests,
        photoUrl,
        allowDiscovery: $("#allow-discovery").checked
      };

      if (state.demo) {
        state.user = { ...state.user, ...profile, profileComplete: true };
      } else {
        const data = await api("saveProfile", profile);
        state.user = data.user;
      }

      state.pendingPhotoDataUrl = "";
      setStatus("profile-status", "Profile saved.", "success");
      enterMain();
    } catch (error) {
      setStatus("profile-status", error.message, "error");
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function bindDiscovery() {
    $("#refresh-discover").addEventListener("click", loadDiscover);
    $("#empty-refresh").addEventListener("click", loadDiscover);
    $("#pass-button").addEventListener("click", () => swipe("PASS"));
    $("#like-button").addEventListener("click", () => swipe("LIKE"));
  }

  async function loadDiscover() {
    if (state.demo) {
      if (!state.cards.length) state.cards = demoProfiles();
      renderDeck();
      return;
    }
    setDeckLoading();
    try {
      const data = await api("discover", { limit: 20 });
      state.cards = data.profiles || [];
      renderDeck();
    } catch (error) {
      state.cards = [];
      renderDeck();
      toast(error.message, "error");
    }
  }

  function setDeckLoading() {
    $("#empty-deck").classList.add("hidden");
    const deck = $("#card-deck");
    deck.classList.remove("hidden");
    deck.innerHTML = '<div class="empty-state glass"><div class="empty-icon">◌</div><h3>Loading profiles…</h3></div>';
  }

  function renderDeck() {
    const deck = $("#card-deck");
    deck.textContent = "";
    $("#empty-deck").classList.toggle("hidden", state.cards.length > 0);
    deck.classList.toggle("hidden", state.cards.length === 0);
    $("#pass-button").disabled = state.cards.length === 0;
    $("#like-button").disabled = state.cards.length === 0;

    const visible = state.cards.slice(0, 3);
    for (let i = visible.length - 1; i >= 0; i--) {
      const card = createProfileCard(visible[i], i === 0);
      deck.append(card);
    }
  }

  function createProfileCard(profile, interactive) {
    const card = document.createElement("article");
    card.className = "profile-card";
    card.dataset.userId = profile.userId;

    const photo = document.createElement("div");
    photo.className = "card-photo";
    if (isSafeImageUrl(profile.photoUrl)) {
      const img = document.createElement("img");
      img.src = profile.photoUrl;
      img.alt = `${profile.displayName}'s display photo`;
      img.loading = "eager";
      img.referrerPolicy = "no-referrer";
      photo.append(img);
    }

    const likeStamp = document.createElement("div");
    likeStamp.className = "swipe-stamp like-stamp";
    likeStamp.textContent = "LIKE";
    const passStamp = document.createElement("div");
    passStamp.className = "swipe-stamp pass-stamp";
    passStamp.textContent = "PASS";

    const content = document.createElement("div");
    content.className = "card-content";
    const nameRow = document.createElement("div");
    nameRow.className = "card-name-row";
    const name = document.createElement("h3");
    name.textContent = profile.displayName;
    const year = document.createElement("span");
    year.textContent = `${profile.program || "Student"} · Year ${profile.year || "—"}`;
    nameRow.append(name, year);

    const meta = document.createElement("p");
    meta.className = "card-meta";
    meta.textContent = profile.lookingFor || "Open to meaningful connections";
    const bio = document.createElement("p");
    bio.className = "card-bio";
    bio.textContent = profile.bio || "No bio yet.";
    const chips = document.createElement("div");
    chips.className = "card-interests";
    (profile.interests || []).slice(0, 5).forEach(interest => {
      const chip = document.createElement("span");
      chip.textContent = interest;
      chips.append(chip);
    });

    content.append(nameRow, meta, bio, chips);
    card.append(photo, likeStamp, passStamp, content);
    if (interactive) attachDrag(card, likeStamp, passStamp);
    return card;
  }

  function attachDrag(card, likeStamp, passStamp) {
    let startX = 0;
    let deltaX = 0;
    let dragging = false;

    card.addEventListener("pointerdown", event => {
      if (state.swipeBusy) return;
      dragging = true;
      startX = event.clientX;
      card.setPointerCapture(event.pointerId);
      card.classList.add("dragging");
    });

    card.addEventListener("pointermove", event => {
      if (!dragging) return;
      deltaX = event.clientX - startX;
      const rotate = deltaX / 18;
      card.style.transform = `translateX(${deltaX}px) rotate(${rotate}deg)`;
      const strength = Math.min(Math.abs(deltaX) / 110, 1);
      likeStamp.style.opacity = deltaX > 0 ? strength : 0;
      passStamp.style.opacity = deltaX < 0 ? strength : 0;
    });

    const finish = () => {
      if (!dragging) return;
      dragging = false;
      card.classList.remove("dragging");
      if (Math.abs(deltaX) >= 105) {
        swipe(deltaX > 0 ? "LIKE" : "PASS");
      } else {
        card.style.transform = "";
        likeStamp.style.opacity = 0;
        passStamp.style.opacity = 0;
      }
      deltaX = 0;
    };

    card.addEventListener("pointerup", finish);
    card.addEventListener("pointercancel", finish);
  }

  async function swipe(decision) {
    if (state.swipeBusy || !state.cards.length) return;
    state.swipeBusy = true;
    const profile = state.cards[0];
    const card = $(".profile-card:last-child", $("#card-deck"));
    if (card) {
      card.style.transform = `translateX(${decision === "LIKE" ? 680 : -680}px) rotate(${decision === "LIKE" ? 22 : -22}deg)`;
      card.style.opacity = "0";
    }

    try {
      let result = { matched: false };
      if (!state.demo) result = await api("swipe", { targetUserId: profile.userId, decision });
      state.cards.shift();
      setTimeout(renderDeck, 160);

      if (decision === "LIKE" && state.demo && Math.random() > 0.55) {
        result = {
          matched: true,
          match: { matchId: `demo-${profile.userId}`, otherUserId: profile.userId },
          otherProfile: profile
        };
        state.matches.unshift({ ...result.match, profile });
      }
      if (result.matched) showMatch(result.match, result.otherProfile || profile);
    } catch (error) {
      if (card) {
        card.style.transform = "";
        card.style.opacity = "1";
      }
      toast(error.message, "error");
    } finally {
      state.swipeBusy = false;
    }
  }

  function showMatch(match, otherProfile) {
    state.activeMatch = { ...match, profile: otherProfile };
    setAvatar($("#match-self-avatar"), state.user.photoUrl, state.user.displayName || "You");
    setAvatar($("#match-other-avatar"), otherProfile.photoUrl, otherProfile.displayName || "Match");
    $("#match-message").textContent = `You and ${otherProfile.displayName} independently liked each other.`;
    openModal("match-modal");
  }

  function bindMatches() {
    $("#refresh-matches").addEventListener("click", loadMatches);
    $("#start-chat-button").addEventListener("click", () => {
      closeModal("match-modal");
      if (state.activeMatch) openChat(state.activeMatch);
    });
  }

  async function loadMatches() {
    try {
      if (!state.demo) {
        const data = await api("matches", {});
        state.matches = data.matches || [];
      }
      renderMatches();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderMatches() {
    const root = $("#matches-list");
    root.textContent = "";
    $("#empty-matches").classList.toggle("hidden", state.matches.length > 0);
    state.matches.forEach(match => {
      const profile = match.profile || match.otherProfile || {};
      const card = document.createElement("article");
      card.className = "match-card";
      card.tabIndex = 0;
      const photo = document.createElement("div");
      photo.className = "match-photo";
      if (isSafeImageUrl(profile.photoUrl)) {
        const img = document.createElement("img");
        img.src = profile.photoUrl;
        img.alt = `${profile.displayName || "Match"}'s photo`;
        img.referrerPolicy = "no-referrer";
        photo.append(img);
      }
      const info = document.createElement("div");
      info.className = "match-info";
      const title = document.createElement("h3");
      title.textContent = profile.displayName || "Your match";
      const sub = document.createElement("p");
      sub.textContent = match.lastMessage || "Start a respectful conversation";
      info.append(title, sub);
      card.append(photo, info);
      card.addEventListener("click", () => openChat(match));
      card.addEventListener("keydown", event => {
        if (event.key === "Enter") openChat(match);
      });
      root.append(card);
    });
  }

  function bindChat() {
    $("#chat-back").addEventListener("click", () => navigate("matches"));
    $("#message-form").addEventListener("submit", sendMessage);
    $("#message-input").addEventListener("input", autoSizeMessageInput);
    $("#chat-menu-button").addEventListener("click", () => $("#chat-menu").classList.toggle("hidden"));
    $("#report-user").addEventListener("click", () => {
      $("#chat-menu").classList.add("hidden");
      openModal("report-modal");
    });
    $("#block-user").addEventListener("click", blockActiveUser);
    $("#report-form").addEventListener("submit", submitReport);
  }

  async function openChat(match) {
    state.activeMatch = match;
    state.messages = [];
    state.lastMessageAt = "";
    const profile = match.profile || match.otherProfile || {};
    $("#chat-title").textContent = profile.displayName || "Conversation";
    setAvatar($("#chat-avatar"), profile.photoUrl, profile.displayName || "?");
    $("#message-list").innerHTML = '<div class="empty-state"><p>Loading conversation…</p></div>';
    navigate("chat");
    await loadMessages(true);
    startChatPolling();
  }

  function startChatPolling() {
    stopChatPolling();
    state.chatTimer = setInterval(() => loadMessages(false), Math.max(2000, CFG.CHAT_POLL_MS));
  }

  function stopChatPolling() {
    if (state.chatTimer) clearInterval(state.chatTimer);
    state.chatTimer = null;
  }

  async function loadMessages(full = false) {
    if (!state.activeMatch) return;
    if (state.demo) {
      renderMessages();
      return;
    }
    try {
      const data = await api("messages", {
        matchId: state.activeMatch.matchId,
        after: full ? "" : state.lastMessageAt,
        limit: 200
      });
      const incoming = data.messages || [];
      if (full) state.messages = incoming;
      else {
        const known = new Set(state.messages.map(message => message.messageId));
        incoming.forEach(message => {
          if (!known.has(message.messageId)) state.messages.push(message);
        });
      }
      if (state.messages.length) state.lastMessageAt = state.messages[state.messages.length - 1].sentAt;
      renderMessages();
    } catch (error) {
      if (full) toast(error.message, "error");
    }
  }

  function renderMessages() {
    const root = $("#message-list");
    root.textContent = "";
    if (!state.messages.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = "<h3>Start with something genuine.</h3><p>Shared interests make a better opening than a generic hello.</p>";
      root.append(empty);
      return;
    }
    state.messages.forEach(message => {
      const row = document.createElement("div");
      row.className = `message-row ${message.senderId === state.user.userId ? "mine" : "theirs"}`;
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      const text = document.createElement("span");
      text.textContent = message.text;
      const time = document.createElement("time");
      time.dateTime = message.sentAt;
      time.textContent = formatTime(message.sentAt);
      bubble.append(text, time);
      row.append(bubble);
      root.append(row);
    });
    root.scrollTop = root.scrollHeight;
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!state.activeMatch) return;
    const input = $("#message-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    autoSizeMessageInput({ target: input });

    const optimistic = {
      messageId: `local-${Date.now()}`,
      senderId: state.user.userId,
      text,
      sentAt: new Date().toISOString()
    };
    state.messages.push(optimistic);
    renderMessages();

    try {
      if (state.demo) return;
      const data = await api("sendMessage", { matchId: state.activeMatch.matchId, text });
      const index = state.messages.findIndex(message => message.messageId === optimistic.messageId);
      if (index >= 0) state.messages[index] = data.message;
      state.lastMessageAt = data.message.sentAt;
    } catch (error) {
      state.messages = state.messages.filter(message => message.messageId !== optimistic.messageId);
      input.value = text;
      renderMessages();
      toast(error.message, "error");
    }
  }

  function autoSizeMessageInput(event) {
    const input = event.target;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  }

  async function submitReport(event) {
    event.preventDefault();
    if (!state.activeMatch) return;
    const profile = state.activeMatch.profile || state.activeMatch.otherProfile || {};
    try {
      if (!state.demo) {
        await api("report", {
          targetUserId: profile.userId || state.activeMatch.otherUserId,
          matchId: state.activeMatch.matchId,
          category: $("#report-category").value,
          details: $("#report-details").value.trim()
        });
      }
      event.target.reset();
      closeModal("report-modal");
      toast("Report submitted to the configured moderator record.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function blockActiveUser() {
    if (!state.activeMatch) return;
    const profile = state.activeMatch.profile || state.activeMatch.otherProfile || {};
    const targetUserId = profile.userId || state.activeMatch.otherUserId;
    if (!confirm(`Block ${profile.displayName || "this user"}? The match will be hidden and messaging disabled.`)) return;
    try {
      if (!state.demo) await api("block", { targetUserId, matchId: state.activeMatch.matchId });
      state.matches = state.matches.filter(match => match.matchId !== state.activeMatch.matchId);
      state.activeMatch = null;
      $("#chat-menu").classList.add("hidden");
      navigate("matches");
      toast("User blocked.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function bindSettings() {
    $("#edit-profile").addEventListener("click", () => {
      populateProfileForm(state.user);
      showScreen("onboarding");
    });
    $("#settings-discovery").addEventListener("change", updateDiscoveryVisibility);
    $("#logout-button").addEventListener("click", logout);
    $("#delete-account").addEventListener("click", deleteAccount);
  }

  function updateCurrentUserUI() {
    if (!state.user) return;
    setAvatar($("#profile-menu-button"), state.user.photoUrl, state.user.displayName || "U");
    setAvatar($("#settings-avatar"), state.user.photoUrl, state.user.displayName || "U");
    $("#settings-name").textContent = state.user.displayName || "Your profile";
    $("#settings-email").textContent = state.user.email || "";
    $("#settings-discovery").checked = state.user.allowDiscovery !== false;
  }

  async function updateDiscoveryVisibility(event) {
    const allowDiscovery = event.target.checked;
    try {
      if (!state.demo) {
        const data = await api("setDiscovery", { allowDiscovery });
        state.user = data.user;
      } else {
        state.user.allowDiscovery = allowDiscovery;
      }
      toast(allowDiscovery ? "Your profile is visible in discovery." : "Your profile is hidden from discovery.", "success");
    } catch (error) {
      event.target.checked = !allowDiscovery;
      toast(error.message, "error");
    }
  }

  async function logout() {
    try {
      if (!state.demo && state.sessionToken) await api("logout", {});
    } catch (_) {
      // Local sign-out must still succeed if the backend cannot be reached.
    }
    window.google?.accounts?.id?.disableAutoSelect();
    clearSession();
    location.reload();
  }

  async function deleteAccount() {
    if (!confirm("Delete and anonymize your profile? This removes discovery access and invalidates your sessions. This action cannot be undone from the interface.")) return;
    try {
      if (!state.demo) await api("deleteAccount", { confirmation: "DELETE" });
      clearSession();
      alert("Your account was anonymized and signed out.");
      location.reload();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function clearSession() {
    stopChatPolling();
    sessionStorage.removeItem("iitiSparkSession");
    state.sessionToken = "";
    state.user = null;
    state.cards = [];
    state.matches = [];
    state.activeMatch = null;
  }

  function initializeApiBridge() {
    if (state.bridgeReadyPromise) return state.bridgeReadyPromise;
    state.bridgeReadyPromise = new Promise(resolve => { state.bridgeReadyResolve = resolve; });
    window.addEventListener("message", handleBridgeMessage);
    const frame = document.createElement("iframe");
    frame.id = "iiti-spark-api-bridge";
    frame.title = "IITI Spark API bridge";
    frame.setAttribute("aria-hidden", "true");
    frame.style.display = "none";
    frame.src = `${CFG.API_URL}${CFG.API_URL.includes("?") ? "&" : "?"}action=bridge`;
    frame.addEventListener("error", () => {
      setStatus("auth-status", "The backend bridge could not load. Confirm the Apps Script deployment URL and iframe permission.", "error");
    });
    state.bridgeFrame = frame;
    document.body.append(frame);
    return state.bridgeReadyPromise;
  }

  function handleBridgeMessage(event) {
    if (!state.bridgeFrame || event.source !== state.bridgeFrame.contentWindow) return;
    const data = event.data || {};
    if (data.type === "IITI_SPARK_BRIDGE_READY") {
      if (!isTrustedBridgeOrigin(event.origin)) return;
      state.bridgeOrigin = event.origin;
      if (state.bridgeReadyResolve) state.bridgeReadyResolve(true);
      state.bridgeReadyResolve = null;
      return;
    }
    if (data.type !== "IITI_SPARK_API_RESPONSE" || event.origin !== state.bridgeOrigin) return;
    const pending = state.bridgePending.get(data.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    state.bridgePending.delete(data.requestId);
    const result = data.result || {};
    if (!result.ok) pending.reject(new Error(result.error || "The request could not be completed."));
    else pending.resolve(result.data || {});
  }

  function isTrustedBridgeOrigin(origin) {
    try {
      const host = new URL(origin).hostname;
      return origin.startsWith("https://") && (host === "script.google.com" || host === "script.googleusercontent.com" || host.endsWith(".googleusercontent.com"));
    } catch (_) {
      return false;
    }
  }

  async function waitForBridge() {
    if (!state.bridgeReadyPromise) initializeApiBridge();
    await Promise.race([
      state.bridgeReadyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("The Google Apps Script backend bridge did not become ready.")), 15000))
    ]);
    if (!state.bridgeOrigin || !state.bridgeFrame?.contentWindow) throw new Error("The backend bridge is unavailable.");
  }

  async function api(action, payload = {}, authenticated = true) {
    if (!hasBackendConfig()) throw new Error("The API URL or Google Client ID is not configured.");
    await waitForBridge();
    const requestId = window.crypto?.randomUUID?.() || `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const request = {
      action,
      payload,
      sessionToken: authenticated ? state.sessionToken : ""
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.bridgePending.delete(requestId);
        reject(new Error("The backend request timed out."));
      }, 30000);
      state.bridgePending.set(requestId, { resolve, reject, timer });
      state.bridgeFrame.contentWindow.postMessage({
        type: "IITI_SPARK_API_REQUEST",
        requestId,
        request
      }, state.bridgeOrigin);
    });
  }

  function setStatus(id, message, type = "") {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message || "";
    element.className = `status-text ${type}`.trim();
  }

  function toast(message, type = "") {
    const item = document.createElement("div");
    item.className = `toast ${type}`.trim();
    item.textContent = message;
    $("#toast-region").append(item);
    setTimeout(() => item.remove(), 4200);
  }

  function setAvatar(container, url, name) {
    container.textContent = "";
    if (isSafeImageUrl(url)) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => {
        container.textContent = initials(name);
      };
      container.append(img);
    } else {
      container.textContent = initials(name);
    }
  }

  function initials(name = "?") {
    return String(name).trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase() || "?";
  }

  function isSafeImageUrl(value) {
    if (!value) return false;
    if (value.startsWith("data:image/")) return true;
    try {
      return new URL(value).protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }).format(date);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read the selected photo."));
      reader.readAsDataURL(file);
    });
  }

  function demoProfiles() {
    return [
      {
        userId: "demo-1", displayName: "Mira", program: "M.Sc", year: "2",
        lookingFor: "Friends first", bio: "Astronomy, indie music, badminton, and finding the best chai after a long lab day.",
        interests: ["Music", "Badminton", "Nature", "Coffee"], photoUrl: ""
      },
      {
        userId: "demo-2", displayName: "Arjun", program: "B.Tech", year: "4",
        lookingFor: "Open to seeing where it goes", bio: "Robotics person by day, movie nerd by night. I make surprisingly good pasta.",
        interests: ["Coding", "Movies", "Food", "Startups"], photoUrl: ""
      },
      {
        userId: "demo-3", displayName: "Tara", program: "Ph.D.", year: "3",
        lookingFor: "People for meaningful connections", bio: "Research, long walks, old Hindi songs, and conversations that accidentally last three hours.",
        interests: ["Research", "Books", "Night walks", "Deep conversations"], photoUrl: ""
      },
      {
        userId: "demo-4", displayName: "Kabir", program: "M.Tech", year: "1",
        lookingFor: "People for dating", bio: "Always planning the next trek. Currently learning guitar and losing at chess.",
        interests: ["Travel", "Nature", "Chess", "Fitness"], photoUrl: ""
      }
    ];
  }
})();
