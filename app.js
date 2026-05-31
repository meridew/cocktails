/* ============================================================
   COCKTAILS — app logic
   One data source (DRINKS) drives the menu, the configurator, the
   order basket, favourites and re-ordering. Every drink is composed
   from reusable option axes; the first is Boozy/Boring, and tapping
   any drink opens the same configurator sheet.
   ============================================================ */
(function () {
  "use strict";

  // Set once mixology boots — lets the Discover tab launch the builder.
  var openDiscover = null;

  // ---- Option axes: small, reusable building blocks --------------------
  // A drink is composed from these. Each axis: { key, label, choices[],
  // showIf?(config) }. A choice: { value, label, emoji?, tag?, adds?[] }.
  // `tag` appears on the order line + ticket; `adds` appends to the recipe.

  // The first question on every spirit drink: alcoholic or not.
  // "Boozy" pours the drink's `spirits`; "Boring" leaves them out.
  var BOOZE_OPT = {
    key: "booze", label: "Make it",
    choices: [
      { value: "Boozy",  label: "Boozy",  emoji: "🥃" },
      { value: "Boring", label: "Boring", emoji: "🌱", tag: "Boring" },
    ],
  };

  // Shots — only meaningful when there's alcohol, so hidden when "Boring".
  var STRENGTH_OPT = {
    key: "strength", label: "Strength",
    showIf: function (c) { return c.booze !== "Boring"; },
    choices: [
      { value: "Single", label: "Single", tag: "Single" },
      { value: "Double", label: "Double", tag: "Double", adds: ["Extra shot"] },
    ],
  };

  // Glassware. Short = tumbler / rocks, Long = highball.
  var SERVE_OPT = {
    key: "serve", label: "Serve",
    choices: [
      { value: "Short", label: "Short", emoji: "🥃", tag: "Short", adds: ["Tumbler"] },
      { value: "Long",  label: "Long",  emoji: "🥤", tag: "Long",  adds: ["Highball glass"] },
    ],
  };

  // Ice. "Cubes" is the unremarkable default (no tag).
  var ICE_OPT = {
    key: "ice", label: "Ice",
    choices: [
      { value: "Cubes",   label: "Cubes",   emoji: "🧊" },
      { value: "Crushed", label: "Crushed", emoji: "❄️", tag: "Crushed ice" },
      { value: "None",    label: "None",    emoji: "🚫", tag: "No ice" },
    ],
  };

  // Garnish on/off (default on).
  var GARNISH_OPT = {
    key: "garnish", label: "Garnish",
    choices: [
      { value: "Yes", label: "Yes", emoji: "🌿" },
      { value: "No",  label: "No",  emoji: "🚫", tag: "No garnish" },
    ],
  };

  // Margarita-only axes.
  var MARGBASE_OPT = {
    key: "base", label: "Flavour",
    choices: [
      { value: "Classic",    label: "Classic" },
      { value: "Watermelon", label: "Watermelon", emoji: "🍉", tag: "Watermelon", adds: ["Watermelon"] },
    ],
  };
  var SPICE_OPT = {
    key: "spicy", label: "Spice",
    choices: [
      { value: "No",    label: "No" },
      { value: "Spicy", label: "Spicy", emoji: "🌶️", tag: "Spicy", adds: ["Fresh Chili"] },
    ],
  };

  // Wine axes.
  var WINE_COLOUR_OPT = {
    key: "colour", label: "Colour",
    choices: [
      { value: "White", label: "White", emoji: "🤍", tag: "White" },
      { value: "Red",   label: "Red",   emoji: "❤️", tag: "Red" },
      { value: "Rosé",  label: "Rosé",  emoji: "🩷", tag: "Rosé" },
    ],
  };
  var WINE_ICE_OPT = {
    key: "ice", label: "Ice", showIf: function (c) { return c.colour === "White" || c.colour === "Rosé"; },
    choices: [
      { value: "1 cube",  label: "1 cube",  emoji: "🧊", tag: "1 cube",  adds: ["1 ice cube"] },
      { value: "2 cubes", label: "2 cubes", emoji: "🧊", tag: "2 cubes", adds: ["2 ice cubes"] },
    ],
  };

  // ---- Data: the menu, one flat list of drinks ------------------------
  // `spirits` are poured when Boozy; `baseIngredients` are always present.
  // The Boozy/Boring axis is shown automatically when a drink has spirits,
  // unless `boozeChoice: false` (then it's always boozy — e.g. Old Fashioned).
  var DRINKS = [
    {
      name: "Margarita", emoji: "🍹",
      spirits: ["Tequila", "Triple Sec / Cointreau"],
      baseIngredients: ["Lime", "Agave", "Salt rim", "Crushed Ice"],
      axes: [MARGBASE_OPT, SPICE_OPT, STRENGTH_OPT, GARNISH_OPT],
    },
    {
      name: "Mojito", emoji: "🌿",
      spirits: ["White Rum"],
      baseIngredients: ["Fresh Mint", "Lime", "Sugar", "Soda Water", "Crushed Ice"],
      axes: [STRENGTH_OPT, GARNISH_OPT, SERVE_OPT],
    },
    {
      name: "Moscow Mule", emoji: "🫚",
      spirits: ["Vodka"],
      baseIngredients: ["Lime", "Ginger Beer", "Fresh Ginger", "Cubes"],
      axes: [STRENGTH_OPT, ICE_OPT, SERVE_OPT],
    },
    {
      name: "Old Fashioned", emoji: "🥃", boozeChoice: false,
      spirits: ["Bourbon / Rye Whiskey"],
      baseIngredients: ["Sugar Cube", "Angostura Bitters", "Orange Peel", "Large Ice Cube"],
      axes: [STRENGTH_OPT],
    },
    {
      name: "Pom & Elderflower", emoji: "🌸",
      spirits: ["Prosecco"],
      baseIngredients: ["Pomegranate Juice", "Elderflower Cordial", "Lime", "Soda Water"],
      axes: [ICE_OPT, GARNISH_OPT],
    },
    {
      name: "Wine", emoji: "🍷", boozeChoice: false,
      spirits: [],
      baseIngredients: ["House wine"],
      axes: [WINE_COLOUR_OPT, WINE_ICE_OPT],
    },
  ];

  // ---- Storage keys + element refs -------------------------------------
  var NAME_KEY  = "cocktail_name";
  var FAV_KEY   = "cocktail_favs";
  var LAST_KEY  = "cocktail_last_order";
  var ORDERS_KEY = "cocktail_orders";

  var $ = function (id) { return document.getElementById(id); };

  var form       = $("request-form");
  var nameInput  = $("name");
  var statusEl   = $("status");
  var submitBtn  = $("submit-btn");
  var basketEl   = $("basket");
  var orderField = $("order-field");
  var sectionsEl = $("menu-sections");
  var surpriseBtn = $("surprise");

  var orderBadge = $("order-badge");

  var overlay       = $("celebrate");
  var overlayTitle  = $("celebrate-title");
  var overlayMsg    = $("celebrate-msg");
  var overlayBurst  = $("celebrate-burst");
  var orderAgainBtn = $("order-again");

  var confirmOverlay = $("confirm");
  var confirmNo      = $("confirm-no");
  var confirmYes     = $("confirm-yes");

  // customise sheet
  var sheet    = $("customise");
  var czTitle  = $("cz-title");
  var czBody   = $("cz-body");
  var czRecipe = $("cz-recipe");
  var czAdd    = $("cz-add");
  var czClose  = $("cz-close");

  // bartender mode
  var bartender     = $("bartender");
  var btTitle       = $("bartender-title");
  var bartenderList = $("bartender-list");
  var btOpen        = $("bartender-open");
  var btClose       = $("bartender-close");
  var btShowDone    = $("bt-show-done");
  var btExport      = $("bt-export");
  var btClear       = $("bt-clear");

  // ---- Helpers ----------------------------------------------------------
  function reducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function lsJSON(k) { try { var v = JSON.parse(lsGet(k)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }

  // ---- NAS order API (set window.COCKTAIL_API in config.js) ------------
  // When configured, orders POST to the NAS and bartender mode reads the
  // shared queue from it. Otherwise everything falls back to local/email.
  var API = (function () {
    var a = window.COCKTAIL_API;
    return (a && a.indexOf("CHANGE-ME") === -1 && /^https:\/\//.test(a)) ? a : null;
  })();
  var BT_KEY_STORE = "bartender_key";
  function noop() {}
  function apiCall(action, init, key) {
    init = init || {};
    var headers = {};
    if (key) { headers["X-Bartender-Key"] = key; }
    if (init.json) { headers["Content-Type"] = "application/json"; }
    return fetch(API + "?action=" + action, {
      method: init.method || "GET",
      headers: headers,
      body: init.json ? JSON.stringify(init.json) : undefined,
    }).then(function (res) {
      if (res.status === 401) { var e = new Error("unauthorized"); e.unauthorized = true; throw e; }
      if (!res.ok) { throw new Error("http " + res.status); }
      return res.json();
    });
  }

  // Every drink is configured the same way; its id is just its name.
  function baseId(item) { return item.name; }
  function isBoozy(item, config) {
    if (item.boozeChoice === false) { return item.spirits && item.spirits.length > 0; }
    return config.booze === "Boozy"; // toggle present; "Boozy" is the default
  }
  function findChoice(opt, val) {
    for (var i = 0; i < opt.choices.length; i++) { if (opt.choices[i].value === val) { return opt.choices[i]; } }
    return opt.choices[0];
  }
  // The ordered axis list for a drink: the Boozy/Boring axis is prepended
  // automatically when the drink has spirits and hasn't opted out.
  function axesFor(item) {
    var hasBooze = item.boozeChoice !== false && item.spirits && item.spirits.length > 0;
    return (hasBooze ? [BOOZE_OPT] : []).concat(item.axes || []);
  }
  // Axes can declare showIf(config) to appear only for certain choices
  // (e.g. Strength hides when "Boring"). Inactive axes are ignored when
  // building the line, recipe and ticket.
  function activeOptions(item, config) {
    return axesFor(item).filter(function (opt) { return !opt.showIf || opt.showIf(config); });
  }

  // Index every drink by id (for favourites + re-order validation).
  var itemIndex = {};
  DRINKS.forEach(function (item) { itemIndex[baseId(item)] = { item: item }; });

  // ---- Favourites + last order (persisted) -----------------------------
  var favs = lsJSON(FAV_KEY);
  function isFav(id) { return favs.indexOf(id) !== -1; }

  var lastOrder = lsJSON(LAST_KEY).filter(function (l) { return itemIndex[l.base || l.id]; });

  // ---- Order line builders ---------------------------------------------
  // A line: { id, base, name, emoji, qty }. `id` encodes the config so
  // identical configs stack and different ones stay separate.
  function lineForConfig(item, config) {
    var base = baseId(item);
    var idParts = [base];
    var tags = [];
    activeOptions(item, config).forEach(function (opt) {
      var val = config[opt.key];
      idParts.push(val);
      var choice = findChoice(opt, val);
      if (choice.tag) { tags.push(choice.tag); }
    });
    var name = item.name + (tags.length ? " · " + tags.join(" · ") : "");
    return { id: idParts.join("|"), base: base, name: name, emoji: item.emoji };
  }
  function recipeFor(item, config) {
    var list = (item.baseIngredients || []).slice();
    if (isBoozy(item, config) && item.spirits) { list = item.spirits.concat(list); }
    activeOptions(item, config).forEach(function (opt) {
      var choice = findChoice(opt, config[opt.key]);
      if (choice.adds) { list = list.concat(choice.adds); }
    });
    return list;
  }

  // ---- The order basket -------------------------------------------------
  var basket = []; // [{ id, base, name, emoji, qty }]

  function findLine(id) {
    for (var i = 0; i < basket.length; i++) { if (basket[i].id === id) { return basket[i]; } }
    return null;
  }
  function addLine(line) {
    var existing = findLine(line.id);
    if (existing) { existing.qty++; }
    else { basket.push({ id: line.id, base: line.base, name: line.name, emoji: line.emoji, qty: 1 }); }
    renderBasket();
    bumpPill();
  }
  function changeQty(id, delta) {
    var line = findLine(id);
    if (!line) { return; }
    line.qty += delta;
    if (line.qty <= 0) { basket = basket.filter(function (l) { return l.id !== id; }); }
    renderBasket();
  }
  function totalCount() { return basket.reduce(function (n, l) { return n + l.qty; }, 0); }
  function orderSummary() { return basket.map(function (l) { return l.qty + "× " + l.name; }).join(", "); }

  function renderBasket() {
    var count = totalCount();

    if (!basket.length) {
      var html = '<p class="basket-empty">Your order is empty — tap a drink to start. 🍸</p>';
      if (lastOrder.length) {
        var summary = lastOrder.map(function (l) { return l.qty + "× " + l.name; }).join(", ");
        html += '<button type="button" class="reorder-btn">🔁 Re-order your last: ' + escapeHtml(summary) + "</button>";
      }
      basketEl.innerHTML = html;
    } else {
      var rows = basket.map(function (l) {
        return (
          '<li class="basket-item" data-id="' + escapeHtml(l.id) + '">' +
            '<span class="basket-item-name"><span class="emoji">' + l.emoji + "</span>" + escapeHtml(l.name) + "</span>" +
            '<span class="qty">' +
              '<button type="button" class="qty-btn" data-act="dec" aria-label="One fewer ' + escapeHtml(l.name) + '">−</button>' +
              '<span class="qty-n">' + l.qty + "</span>" +
              '<button type="button" class="qty-btn" data-act="inc" aria-label="One more ' + escapeHtml(l.name) + '">+</button>' +
            "</span>" +
          "</li>"
        );
      }).join("");
      basketEl.innerHTML =
        '<ul class="basket-list">' + rows + "</ul>" +
        '<button type="button" class="basket-clear">Clear all</button>';
    }

    submitBtn.disabled = count === 0;
    submitBtn.textContent = count === 0 ? "Add something first" : "Send order (" + count + ") 🍹";

    if (orderBadge) { orderBadge.textContent = count; orderBadge.hidden = count === 0; }
    orderField.value = orderSummary();
  }

  // Basket controls (event-delegated so they survive re-renders).
  basketEl.addEventListener("click", function (e) {
    if (e.target.closest(".reorder-btn")) {
      basket = lastOrder.map(function (l) { return { id: l.id, base: l.base, name: l.name, emoji: l.emoji, qty: l.qty }; });
      renderBasket();
      bumpPill();
      return;
    }
    if (e.target.closest(".basket-clear")) {
      basket = [];
      renderBasket();
      return;
    }
    var btn = e.target.closest(".qty-btn");
    if (!btn) { return; }
    var row = btn.closest(".basket-item");
    var id = row && row.getAttribute("data-id");
    if (!id) { return; }
    changeQty(id, btn.getAttribute("data-act") === "inc" ? 1 : -1);
  });

  // Pulse the Order tab when something's added, so the change is noticed.
  function bumpPill() {
    if (reducedMotion()) { return; }
    var tab = $("order-tab");
    if (!tab) { return; }
    tab.classList.remove("bump");
    void tab.offsetWidth; // restart the animation
    tab.classList.add("bump");
  }

  // ---- Build a menu card — every drink opens the configurator ----------
  function buildCard(item) {
    var id = baseId(item);
    var card = document.createElement("article");
    card.className = "cocktail" + (isFav(id) ? " is-fav" : "");
    card.setAttribute("data-id", id);

    var faved = isFav(id);
    card.innerHTML =
      '<button type="button" class="fav" data-fav-id="' + escapeHtml(id) + '" aria-pressed="' + (faved ? "true" : "false") +
        '" aria-label="' + (faved ? "Remove " : "Save ") + escapeHtml(item.name) + ' to favourites">' + (faved ? "★" : "☆") + "</button>" +
      '<h3><span class="emoji">' + item.emoji + "</span>" + escapeHtml(item.name) + "</h3>" +
      '<button type="button" class="order">Order →</button>';

    card.querySelector(".order").addEventListener("click", function () { openCustomise(item, card.querySelector(".order")); });
    card.querySelector(".fav").addEventListener("click", function () { toggleFav(id); });
    return card;
  }

  // ---- Configurator sheet (the one and only way to add a drink) --------
  var czItem = null, czConfig = {}, czTrigger = null;

  function openCustomise(item, trigger) {
    czItem = item;
    czTrigger = trigger || null;
    czConfig = {};
    axesFor(item).forEach(function (opt) { czConfig[opt.key] = opt.choices[0].value; }); // defaults

    czTitle.textContent = item.name;
    renderOptions();

    updateRecipe();
    sheet.hidden = false;
    document.body.style.overflow = "hidden";
    czAdd.focus();
  }
  function renderOptions() {
    czBody.innerHTML = activeOptions(czItem, czConfig).map(function (opt) {
      var segs = opt.choices.map(function (c) {
        return '<button type="button" class="seg" data-opt="' + escapeHtml(opt.key) + '" data-val="' + escapeHtml(c.value) +
          '" aria-pressed="' + (c.value === czConfig[opt.key] ? "true" : "false") + '">' +
          (c.emoji ? c.emoji + " " : "") + escapeHtml(c.label) + "</button>";
      }).join("");
      return '<div class="opt"><span class="opt-label">' + escapeHtml(opt.label) + '</span><div class="seg-group">' + segs + "</div></div>";
    }).join("");
  }
  function closeCustomise() {
    sheet.hidden = true;
    document.body.style.overflow = "";
    if (czTrigger) { czTrigger.focus(); }
  }
  function updateRecipe() {
    czRecipe.textContent = recipeFor(czItem, czConfig).join(" · ");
  }
  czBody.addEventListener("click", function (e) {
    var seg = e.target.closest(".seg");
    if (!seg) { return; }
    czConfig[seg.getAttribute("data-opt")] = seg.getAttribute("data-val");
    renderOptions(); // re-render so conditional options (e.g. wine ice) show/hide
    updateRecipe();
  });
  czAdd.addEventListener("click", function () {
    addLine(lineForConfig(czItem, czConfig));
    closeCustomise();
  });
  czClose.addEventListener("click", closeCustomise);
  sheet.addEventListener("click", function (e) { if (e.target === sheet) { closeCustomise(); } });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !sheet.hidden) { closeCustomise(); }
  });

  // ---- Favourites: a star per card + a "Faves only" filter chip --------
  var favFilterBtn = $("fav-filter");
  var menuGrid = null;

  function toggleFav(id) {
    var i = favs.indexOf(id);
    if (i === -1) { favs.push(id); } else { favs.splice(i, 1); }
    lsSet(FAV_KEY, JSON.stringify(favs));

    var on = isFav(id);
    var stars = document.querySelectorAll('.fav[data-fav-id="' + id + '"]');
    Array.prototype.forEach.call(stars, function (b) {
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.textContent = on ? "★" : "☆";
    });
    var card = menuGrid && menuGrid.querySelector('.cocktail[data-id="' + id + '"]');
    if (card) { card.classList.toggle("is-fav", on); }
    refreshFavFilter();
  }
  function refreshFavFilter() {
    if (!favFilterBtn) { return; }
    var any = favs.some(function (id) { return itemIndex[id]; });
    favFilterBtn.hidden = !any;
    if (!any && menuGrid) { menuGrid.classList.remove("faves-only"); favFilterBtn.setAttribute("aria-pressed", "false"); }
  }
  if (favFilterBtn) {
    favFilterBtn.addEventListener("click", function () {
      if (!menuGrid) { return; }
      var on = !menuGrid.classList.contains("faves-only");
      menuGrid.classList.toggle("faves-only", on);
      favFilterBtn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  // ---- Build the menu: one flat grid of drinks -------------------------
  menuGrid = document.createElement("div");
  menuGrid.className = "menu";
  DRINKS.forEach(function (item) { menuGrid.appendChild(buildCard(item)); });
  sectionsEl.appendChild(menuGrid);
  refreshFavFilter();

  // ---- 🎲 Surprise: add a random drink with random options -------------
  surpriseBtn.addEventListener("click", function () {
    if (!DRINKS.length) { return; }
    var item = DRINKS[Math.floor(Math.random() * DRINKS.length)];
    var config = {};
    axesFor(item).forEach(function (opt) {
      config[opt.key] = opt.choices[Math.floor(Math.random() * opt.choices.length)].value;
    });
    addLine(lineForConfig(item, config));

    if (!reducedMotion()) {
      surpriseBtn.classList.remove("spin");
      void surpriseBtn.offsetWidth;
      surpriseBtn.classList.add("spin");
    }

    var card = menuGrid && menuGrid.querySelector('.cocktail[data-id="' + baseId(item) + '"]');
    if (card) {
      card.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
      card.classList.remove("just-picked");
      void card.offsetWidth;
      card.classList.add("just-picked");
    }
  });

  // ---- App-shell navigation: tabs / top-nav swap views; Order is a
  //      slide-up sheet (mobile) or the always-on rail (desktop). --------
  var stageViews = { menu: $("view-menu"), ask: $("view-ask") };
  var orderRail = $("order-rail");
  var orderBackdrop = $("order-backdrop");
  var navButtons = document.querySelectorAll("[data-go]");

  function orderSheetOpen() { return orderRail && orderRail.classList.contains("open"); }
  function setOrderSheet(open) {
    if (!orderRail) { return; }
    orderRail.classList.toggle("open", !!open);
    if (orderBackdrop) { orderBackdrop.classList.toggle("open", !!open); }
  }
  function closeOrderSheet() { setOrderSheet(false); }

  function setActiveNav(go) {
    Array.prototype.forEach.call(navButtons, function (b) {
      b.setAttribute("aria-current", b.getAttribute("data-go") === go ? "true" : "false");
    });
  }
  function go(view) {
    if (view === "order") { setOrderSheet(!orderSheetOpen()); return; }
    if (view === "discover") { closeOrderSheet(); if (openDiscover) { openDiscover(); } return; }
    // "menu" / "ask": swap the stage views in place.
    closeOrderSheet();
    Object.keys(stageViews).forEach(function (k) {
      if (stageViews[k]) { stageViews[k].hidden = (k !== view); }
    });
    setActiveNav(view);
    var v = stageViews[view];
    if (v) {
      v.scrollTop = 0;
      var h = v.querySelector("h2, .askbar-title, .hint");
      if (h) { h.setAttribute("tabindex", "-1"); try { h.focus({ preventScroll: true }); } catch (e) {} }
    }
  }
  Array.prototype.forEach.call(navButtons, function (b) {
    b.addEventListener("click", function () { go(b.getAttribute("data-go")); });
  });
  if (orderBackdrop) { orderBackdrop.addEventListener("click", closeOrderSheet); }
  var orderCloseBtn = $("order-close");
  if (orderCloseBtn) { orderCloseBtn.addEventListener("click", closeOrderSheet); }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && orderSheetOpen()) { closeOrderSheet(); }
  });

  // ---- Remember the name across visits ---------------------------------
  try {
    var saved = lsGet(NAME_KEY);
    if (saved) { nameInput.value = saved; }
  } catch (e) { /* ignore */ }
  function rememberName() { lsSet(NAME_KEY, nameInput.value.trim()); }
  nameInput.addEventListener("change", rememberName);

  // ---- Submit flow: confirm gate, then POST the basket via AJAX --------
  form.addEventListener("submit", function (e) {
    e.preventDefault(); // native validation has already ensured a name is present
    if (!basket.length) {
      statusEl.className = "status err";
      statusEl.textContent = "ADD SOMETHING FIRST!";
      return;
    }
    openConfirm(); // cheeky "had enough?" gate before we actually send
  });

  function submitOrder() {
    rememberName();
    orderField.value = orderSummary();
    submitBtn.disabled = true;
    statusEl.className = "status";
    statusEl.textContent = "SENDING…";

    var orderedName = nameInput.value.trim();
    var orderedLines = basket.slice();
    var orderedNote = ($("note").value || "").trim();

    deliverOrder(orderedName, orderedLines, orderedNote)
      .then(function () {
        lastOrder = orderedLines.slice();
        lsSet(LAST_KEY, JSON.stringify(lastOrder));
        saveOrderRecord(orderedName, orderedLines, orderedNote); // local cache / offline export
        basket = [];
        renderBasket();           // clears the list + disables the button
        form.reset();
        nameInput.value = orderedName; // keep their name for the next round
        statusEl.className = "status";
        statusEl.textContent = "";
        celebrate(orderedName, orderedLines);
      })
      .catch(function () {
        statusEl.className = "status err";
        statusEl.textContent = "OOPS — try that again!";
        submitBtn.disabled = false;
      });
  }

  // Send the order to the NAS shared store when configured; else email it.
  function deliverOrder(name, lines, note) {
    if (API) {
      var items = lines.map(function (l) { return { name: l.name, qty: l.qty }; });
      return apiCall("order", { method: "POST", json: { name: name, items: items, note: note } });
    }
    return fetch(form.action, {
      method: "POST",
      body: new FormData(form),
      headers: { Accept: "application/json" },
    }).then(function (res) {
      if (!res.ok) { throw new Error("Bad response"); }
      return res.json();
    });
  }

  // ---- "Had enough already?" confirmation gate -------------------------
  function openConfirm() {
    confirmOverlay.hidden = false;
    document.body.style.overflow = "hidden";
    confirmNo.focus(); // default to the friendly "no, send it" action
  }
  function backOut() {
    confirmOverlay.hidden = true;
    document.body.style.overflow = "";
    submitBtn.focus();
  }
  confirmNo.addEventListener("click", function () {  // "No" → I haven't, send it
    confirmOverlay.hidden = true;
    document.body.style.overflow = "";
    submitOrder();
  });
  confirmYes.addEventListener("click", backOut);     // "Yes" → I've had enough, back out
  confirmOverlay.addEventListener("click", function (e) {
    if (e.target === confirmOverlay) { backOut(); } // tap the backdrop to back out
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !confirmOverlay.hidden) { backOut(); }
  });

  // ---- Success celebration --------------------------------------------
  function celebrate(name, lines) {
    overlayTitle.textContent = name ? "Cheers, " + name + "! 🥂" : "Cheers! 🥂";
    var list = lines
      .map(function (l) { return "<li>" + l.qty + "× " + escapeHtml(l.name) + "</li>"; })
      .join("");
    overlayMsg.innerHTML =
      "Your order is on the way. 🍹" +
      '<ul class="celebrate-order">' + list + "</ul>";
    closeOrderSheet();          // tuck the (now-empty) order sheet away
    overlay.hidden = false;
    document.body.style.overflow = "hidden"; // lock background scroll while open
    fireBurst();
    orderAgainBtn.focus();
  }

  function closeCelebrate() {
    overlay.hidden = true;
    overlayBurst.innerHTML = "";
    document.body.style.overflow = "";
    window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    surpriseBtn.focus(); // back at the top
  }

  function fireBurst() {
    overlayBurst.innerHTML = "";
    if (reducedMotion()) { return; } // no explosion for motion-sensitive users
    var ICONS = ["🎉", "🎊", "🥂", "🍸", "🍹", "🥃", "🍊", "✨", "🍋", "🍉", "⭐", "💫"];
    var N = 38;
    var html = "";
    for (var i = 0; i < N; i++) {
      var icon = ICONS[Math.floor(Math.random() * ICONS.length)];
      var ang = Math.random() * Math.PI * 2;
      var dist = 120 + Math.random() * 220;
      var tx = Math.cos(ang) * dist;
      var ty = Math.sin(ang) * dist + 140; // gravity bias: drift outward, then fall
      var r = Math.random() * 720 - 360;
      var size = 18 + Math.random() * 22;
      var dur = 1.2 + Math.random() * 0.9;
      var delay = Math.random() * 0.15;
      html +=
        '<span style="font-size:' + size + "px;--tx:" + tx + "px;--ty:" + ty +
        "px;--r:" + r + "deg;animation-duration:" + dur + "s;animation-delay:" + delay +
        's">' + icon + "</span>";
    }
    overlayBurst.innerHTML = html;
  }

  orderAgainBtn.addEventListener("click", closeCelebrate);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) { closeCelebrate(); } // tap the backdrop to dismiss
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !overlay.hidden) { closeCelebrate(); }
  });

  // ---- Bartender mode: a local order queue (THIS device only) ----------
  function getOrders() { return lsJSON(ORDERS_KEY); }
  function setOrders(o) { lsSet(ORDERS_KEY, JSON.stringify(o)); }

  function saveOrderRecord(name, lines, note) {
    var orders = getOrders();
    orders.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || "(no name)",
      items: lines.map(function (l) { return { name: l.name, qty: l.qty }; }),
      note: note || "",
      ts: Date.now(),
      status: "pending",
    });
    setOrders(orders);
  }

  function fmtTime(ts) {
    try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return ""; }
  }

  function renderOrders(ordersIn) {
    var orders = (ordersIn || getOrders()).slice().sort(function (a, b) { return b.ts - a.ts; });
    var pending = orders.filter(function (o) { return o.status !== "done"; });
    var view = btShowDone.checked ? orders : pending;

    btTitle.textContent = "🍸 Bartender" + (pending.length ? " (" + pending.length + ")" : "");

    if (!view.length) {
      bartenderList.innerHTML = '<p class="bt-empty">' +
        (btShowDone.checked ? "No orders yet." : "No pending orders. 🎉") + "</p>";
      return;
    }
    bartenderList.innerHTML = view.map(function (o) {
      var done = o.status === "done";
      var items = o.items.map(function (it) { return "<li>" + it.qty + "× " + escapeHtml(it.name) + "</li>"; }).join("");
      return (
        '<article class="bt-order' + (done ? " done" : "") + '">' +
          '<div class="bt-order-head"><span class="bt-name">' + escapeHtml(o.name) + "</span>" +
            '<span class="bt-time">' + fmtTime(o.ts) + "</span></div>" +
          '<ul class="bt-items">' + items + "</ul>" +
          (o.note ? '<p class="bt-note">📝 ' + escapeHtml(o.note) + "</p>" : "") +
          '<div class="bt-actions">' +
            '<button type="button" class="bt-toggle-done" data-id="' + escapeHtml(o.id) + '">' + (done ? "↩ Reopen" : "✓ Complete") + "</button>" +
            '<button type="button" class="bt-del" data-id="' + escapeHtml(o.id) + '" aria-label="Delete order">🗑</button>' +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  // ---- NAS-backed bartender (shared across devices) -------------------
  // When window.COCKTAIL_API is set, the queue lives on the NAS and the
  // bartender unlocks it with the passcode, then we poll for live updates.
  var btKey = lsGet(BT_KEY_STORE) || "";
  var btTimer = null;

  function stopBtPoll() { if (btTimer) { clearInterval(btTimer); btTimer = null; } }
  function startBtPoll() { stopBtPoll(); btTimer = setInterval(fetchBt, 4000); }

  function fetchBt() {
    if (!API || !btKey) { return; }
    apiCall("list", {}, btKey)
      .then(function (d) { renderOrders(d.orders || []); })
      .catch(function (err) {
        if (err && err.unauthorized) { btKey = ""; lsSet(BT_KEY_STORE, ""); btGate("Re-enter the passcode."); }
        // network blips: keep the last view and retry on the next tick
      });
  }

  function btGate(msg) {
    stopBtPoll();
    btTitle.textContent = "🍸 Bartender";
    bartenderList.innerHTML =
      '<div class="bt-empty" style="text-align:left">' +
        "<p>Enter the bartender passcode to see orders from every device.</p>" +
        '<input type="password" id="bt-key" placeholder="Passcode" autocomplete="current-password" ' +
        'style="width:100%;padding:13px;border-radius:10px;border:3px solid #0a0a12;font-size:16px;margin-bottom:10px" />' +
        '<button type="button" id="bt-unlock" ' +
        'style="width:100%;padding:13px;border:3px solid #0a0a12;border-radius:10px;background:#ffe600;font-weight:700;cursor:pointer">Unlock 🔓</button>' +
        (msg ? '<p style="color:#ff2e88;font-weight:700;margin-top:10px">' + escapeHtml(msg) + "</p>" : "") +
      "</div>";
    var keyEl = $("bt-key");
    function tryKey() {
      var k = keyEl.value;
      if (!k) { return; }
      apiCall("list", {}, k)
        .then(function (d) { btKey = k; lsSet(BT_KEY_STORE, k); renderOrders(d.orders || []); startBtPoll(); })
        .catch(function (err) { btGate(err && err.unauthorized ? "Wrong passcode — try again." : "Can't reach the bar API."); });
    }
    $("bt-unlock").addEventListener("click", tryKey);
    keyEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); tryKey(); } });
    keyEl.focus();
  }

  bartenderList.addEventListener("click", function (e) {
    var doneBtn = e.target.closest(".bt-toggle-done");
    var delBtn = e.target.closest(".bt-del");
    if (doneBtn) {
      var id = doneBtn.getAttribute("data-id");
      if (API) {
        var toPending = doneBtn.textContent.indexOf("Reopen") !== -1; // currently done → reopen
        apiCall("status", { method: "POST", json: { id: id, status: toPending ? "pending" : "done" } }, btKey)
          .then(fetchBt).catch(noop);
      } else {
        var orders = getOrders();
        orders.forEach(function (o) { if (o.id === id) { o.status = (o.status === "done") ? "pending" : "done"; } });
        setOrders(orders);
        renderOrders();
      }
    } else if (delBtn) {
      var did = delBtn.getAttribute("data-id");
      if (API) {
        apiCall("delete", { method: "POST", json: { id: did } }, btKey).then(fetchBt).catch(noop);
      } else {
        setOrders(getOrders().filter(function (o) { return o.id !== did; }));
        renderOrders();
      }
    }
  });

  function openBartender() {
    bartender.hidden = false;
    document.body.style.overflow = "hidden";
    if (API) {
      if (btKey) { fetchBt(); startBtPoll(); } else { btGate(""); }
    } else {
      renderOrders();
    }
    btClose.focus();
  }
  function closeBartender() {
    bartender.hidden = true;
    document.body.style.overflow = "";
    stopBtPoll();
    if (location.hash === "#bartender") {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }
  function exportOrders() {
    var blob = new Blob([JSON.stringify(getOrders(), null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "cocktail-orders-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  btOpen.addEventListener("click", openBartender);
  btClose.addEventListener("click", closeBartender);
  btShowDone.addEventListener("change", function () {
    if (API && btKey) { fetchBt(); } else { renderOrders(); }
  });
  btExport.addEventListener("click", exportOrders);
  btClear.addEventListener("click", function () {
    if (API) {
      if (btKey) { apiCall("clear", { method: "POST", json: { which: "done" } }, btKey).then(fetchBt).catch(noop); }
    } else {
      setOrders(getOrders().filter(function (o) { return o.status !== "done"; }));
      renderOrders();
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !bartender.hidden) { closeBartender(); }
  });
  function checkBartenderHash() { if (location.hash === "#bartender") { openBartender(); } }
  window.addEventListener("hashchange", checkBartenderHash);
  checkBartenderHash();

  // Paint the (empty) basket once at startup.
  renderBasket();

  // ====================================================================
  //  BUILD-A-DRINK  (a separate discovery flow, driven by cocktails.json)
  //  The tree is DERIVED, not stored: at each step we offer only the
  //  ingredients that keep at least one real recipe reachable.
  // ====================================================================
  // Shared one-time loader for the cocktail catalogue, used by both the
  // Make-a-Drink flow and the Ask-the-bar / agent tooling below.
  var _cocktailPromise = null;
  function loadCocktails() {
    if (!_cocktailPromise) {
      _cocktailPromise = fetch("cocktails.json").then(function (r) {
        if (!r.ok) { throw new Error("bad response"); }
        return r.json();
      });
    }
    return _cocktailPromise;
  }

  (function mixology() {
    var launchBtn = $("mixology-open");
    var overlay   = $("mixology");
    var closeBtn  = $("mixology-close");
    var buildEl   = $("mx-build");
    var stepEl    = $("mx-step");
    var resultEl  = $("mx-result");
    var backBtn   = $("mx-back");
    if (!overlay) { return; }

    // Emoji per base for the basket line (falls back to a cocktail glass).
    var BASE_EMOJI = {
      Gin: "🍸", Vodka: "🍸", Tequila: "🌵", Mezcal: "🔥", Rum: "🏝️",
      Whiskey: "🥃", Scotch: "🥃", Brandy: "🍇", Cachaça: "🌿", Pisco: "🍇",
      Champagne: "🥂", Prosecco: "🥂"
    };

    var DATA = null;          // loaded cocktails.json
    var loadErr = false;
    var base = null;          // chosen base spirit
    var picked = [];          // chosen ingredients (in order)
    var skipped = [];         // category names the player declined
    var catIndex = 0;         // position in DATA.categoryOrder
    var revealed = null;      // the drink currently shown (for "add to order")
    var trail = [];           // state snapshots powering the Back button

    // Lazy-load the data the first time the mode is opened.
    function ensureData(cb) {
      if (DATA || loadErr) { cb(); return; }
      loadCocktails()
        .then(function (j) { DATA = j; cb(); })
        .catch(function () { loadErr = true; cb(); });
    }

    function catOf(ing) { return DATA.ingredients[ing]; }
    function bases() {
      var seen = {}, out = [];
      DATA.cocktails.forEach(function (c) { if (!seen[c.base]) { seen[c.base] = 1; out.push(c.base); } });
      return out;
    }
    // Recipes still in play: right base, contains everything we've picked,
    // and doesn't need anything from a category we've declined.
    function reachable() {
      return DATA.cocktails.filter(function (c) {
        if (c.base !== base) { return false; }
        if (!picked.every(function (p) { return c.ingredients.indexOf(p) !== -1; })) { return false; }
        return !c.ingredients.some(function (i) {
          return skipped.indexOf(catOf(i)) !== -1 && picked.indexOf(i) === -1;
        });
      });
    }
    // An exact match = a recipe whose ingredient set equals our picks.
    function exactMatch(recipes) {
      for (var i = 0; i < recipes.length; i++) {
        if (recipes[i].ingredients.length === picked.length) { return recipes[i]; }
      }
      return null;
    }
    // How many reachable recipes would survive adding this ingredient?
    function countWith(recipes, ing) {
      return recipes.filter(function (c) { return c.ingredients.indexOf(ing) !== -1; }).length;
    }

    // ---- Back / history -------------------------------------------------
    // Snapshot the screen we're on before the player acts, so Back can
    // restore it. The engine is deterministic from this state, so restoring
    // it and re-rendering reproduces the exact step (auto-folds included).
    function pushTrail() {
      trail.push({ base: base, picked: picked.slice(), skipped: skipped.slice(), catIndex: catIndex });
    }
    // Back doubles as the exit: at the first screen it closes the flow.
    function updateBackBtn() { if (backBtn) { backBtn.textContent = trail.length ? "← Back" : "✕ Close"; } }
    function goBack() {
      if (!trail.length) { close(); return; }
      var s = trail.pop();
      base = s.base; picked = s.picked.slice(); skipped = s.skipped.slice(); catIndex = s.catIndex; revealed = null;
      resultEl.hidden = true; resultEl.innerHTML = "";
      if (!base) { renderBaseScreen(); } else { nextStep(); }
    }

    // Called after every screen change: refresh the Back button, reset
    // scroll, and move focus to the new heading for keyboard/screen readers.
    var scroller = overlay.querySelector(".mx-scroll") || overlay;
    function screenChanged() {
      updateBackBtn();
      scroller.scrollTop = 0;
      var h = stepEl.querySelector(".mx-q") || resultEl.querySelector("h3") || stepEl.querySelector("h3");
      if (h) {
        h.setAttribute("tabindex", "-1");
        try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); }
      }
    }

    // ---- Render helpers -------------------------------------------------
    function renderBuild() {
      if (!base) { buildEl.innerHTML = ""; return; }
      var chips = '<span class="mx-chip mx-chip-base">' + escapeHtml(base) + "</span>" +
        picked.map(function (p) { return '<span class="mx-chip">' + escapeHtml(p) + "</span>"; }).join("");
      buildEl.innerHTML = '<div class="mx-build-row">' + chips + "</div>";
    }

    // options: [{ text, val, count }]
    function btnRow(label, options) {
      var html = '<p class="mx-q">' + escapeHtml(label) + "</p><div class=\"mx-opts\">";
      html += options.map(function (o) {
        var count = o.count ? '<span class="mx-count">' + o.count + "</span>" : "";
        return '<button type="button" class="mx-opt' + (o.cls ? " " + o.cls : "") +
          '" data-val="' + escapeHtml(o.val) + '"><span>' + escapeHtml(o.text) + "</span>" + count + "</button>";
      }).join("");
      return html + "</div>";
    }

    function start() {
      base = null; picked = []; skipped = []; catIndex = 0; revealed = null; trail = [];
      resultEl.hidden = true; resultEl.innerHTML = "";
      renderBuild();
      if (loadErr || !DATA) {
        stepEl.innerHTML = '<p class="mx-q">Couldn’t load the cocktail book. Please try again later.</p>';
        updateBackBtn();
        return;
      }
      renderBaseScreen();
    }

    function renderBaseScreen() {
      renderBuild();
      stepEl.innerHTML = btnRow("Pick your base spirit", bases().map(function (b) {
        return { text: b, val: "base:" + b, count: DATA.cocktails.filter(function (c) { return c.base === b; }).length };
      }));
      screenChanged();
    }

    function nextStep() {
      renderBuild();
      var folded = [];   // ingredients we auto-added because they were forced

      // Walk categories. Auto-fold any step that's a single forced ingredient
      // (no real choice), so the player only ever sees genuine branches.
      while (catIndex < DATA.categoryOrder.length) {
        var recipes = reachable();
        if (!recipes.length) { reveal(null); return; }
        var cat = DATA.categoryOrder[catIndex];

        // Unpicked ingredients of this category present in a reachable recipe.
        var seen = {}, opts = [];
        recipes.forEach(function (c) {
          c.ingredients.forEach(function (ing) {
            if (picked.indexOf(ing) === -1 && catOf(ing) === cat && !seen[ing]) { seen[ing] = 1; opts.push(ing); }
          });
        });

        if (!opts.length) { catIndex++; continue; }   // nothing here

        var exact = exactMatch(recipes);
        // Can we move on without picking here? (some recipe needs nothing more
        // from this category — i.e. it's optional.)
        var canSkip = recipes.some(function (c) {
          return c.ingredients.every(function (i) { return catOf(i) !== cat || picked.indexOf(i) !== -1; });
        });

        // Forced single: one option, not optional, no drink completed yet.
        // Fold it in silently rather than asking a non-question.
        if (opts.length === 1 && !canSkip && !exact) {
          picked.push(opts[0]);
          folded.push(opts[0]);
          renderBuild();
          continue; // same category may offer more, else loop advances
        }

        // A genuine choice — render it. Most-common options first so long
        // lists (e.g. the spirits step) lead with the familiar picks.
        opts.sort(function (a, b) { return countWith(recipes, b) - countWith(recipes, a) || a.localeCompare(b); });
        var choices = opts.map(function (ing) {
          return { text: ing, val: "add:" + ing, count: countWith(recipes, ing) };
        });
        if (exact) {
          choices.push({ text: "Stop here — my " + exact.name, val: "stop", cls: "mx-opt-stop" });
        } else if (canSkip) {
          choices.push({ text: "None of these", val: "skip:" + cat, cls: "mx-opt-skip" });
        }

        var label = DATA.categoryLabels[cat] || "Add something?";
        stepEl.innerHTML =
          (folded.length ? '<p class="mx-auto">Added <strong>' + folded.map(escapeHtml).join("</strong>, <strong>") + "</strong> — the only way forward.</p>" : "") +
          (exact ? '<p class="mx-sofar">Right now you’ve got a <strong>' + escapeHtml(exact.name) + '</strong>. Keep building, or stop here.</p>' : "") +
          btnRow(label, choices);
        screenChanged();
        return;
      }

      // Out of categories — reveal the match.
      reveal(exactMatch(reachable()));
    }

    function reveal(drink) {
      revealed = drink;
      stepEl.innerHTML = "";
      resultEl.hidden = false;
      if (!drink) {
        resultEl.innerHTML = '<div class="mx-card"><h3>Hmm…</h3><p class="mx-blurb">That exact combination isn’t a classic we know — step back and try another path!</p>' +
          '<div class="mx-result-actions"><button type="button" class="mx-again" data-mx="again">Start again ↺</button></div></div>';
        screenChanged();
        return;
      }
      resultEl.innerHTML =
        '<div class="mx-card mx-reveal">' +
          '<p class="mx-congrats">You’ve made a…</p>' +
          "<h3>" + escapeHtml(drink.name) + "</h3>" +
          (drink.blurb ? '<p class="mx-blurb">' + escapeHtml(drink.blurb) + "</p>" : "") +
          '<dl class="mx-spec">' +
            '<dt>Base</dt><dd>' + escapeHtml(drink.base) + "</dd>" +
            (function () {
              var withList = drink.ingredients.filter(function (i) { return catOf(i) !== "method"; });
              return withList.length ? "<dt>With</dt><dd>" + escapeHtml(withList.join(", ")) + "</dd>" : "";
            })() +
            (drink.method ? "<dt>Method</dt><dd>" + escapeHtml(drink.method) + "</dd>" : "") +
            (drink.garnish ? "<dt>Garnish</dt><dd>" + escapeHtml(drink.garnish) + "</dd>" : "") +
            (drink.ice ? "<dt>Ice</dt><dd>" + escapeHtml(drink.ice) + "</dd>" : "") +
            (drink.glass ? "<dt>Glass</dt><dd>" + escapeHtml(drink.glass) + "</dd>" : "") +
          "</dl>" +
          '<div class="mx-result-actions">' +
            '<button type="button" class="mx-add" data-mx="add">Add to my order 🧺</button>' +
            '<button type="button" class="mx-again" data-mx="again">Start again ↺</button>' +
          "</div>" +
        "</div>";
      screenChanged();
    }

    // ---- Event wiring ---------------------------------------------------
    stepEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".mx-opt");
      if (!btn) { return; }
      var val = btn.getAttribute("data-val");
      if (val.indexOf("base:") === 0) { pushTrail(); base = val.slice(5); catIndex = 0; nextStep(); return; }
      if (val === "stop") { pushTrail(); reveal(exactMatch(reachable())); return; }
      if (val.indexOf("skip:") === 0) { pushTrail(); skipped.push(val.slice(5)); catIndex++; nextStep(); return; }
      if (val.indexOf("add:") === 0) { pushTrail(); picked.push(val.slice(4)); nextStep(); return; }
    });

    // Reveal-card actions (add to order / start again).
    resultEl.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-mx]");
      if (!btn) { return; }
      if (btn.getAttribute("data-mx") === "again") { start(); return; }
      if (btn.getAttribute("data-mx") === "add" && revealed) {
        addLine({
          id: "mix-" + revealed.id, base: revealed.base, name: revealed.name,
          emoji: BASE_EMOJI[revealed.base] || "🍸"
        });
        btn.textContent = "Added to your order ✓";
        btn.classList.add("is-added");
        btn.disabled = true;
      }
    });

    function open() {
      ensureData(function () {
        overlay.hidden = false;
        document.body.style.overflow = "hidden";
        start();   // start() renders + moves focus into the panel
      });
    }
    openDiscover = open;   // let the Discover tab launch this flow
    function close() {
      overlay.hidden = true;
      document.body.style.overflow = "";
      if (location.hash === "#make") { history.replaceState(null, "", location.pathname + location.search); }
    }

    if (launchBtn) { launchBtn.addEventListener("click", open); }
    if (closeBtn) { closeBtn.addEventListener("click", close); }
    if (backBtn) { backBtn.addEventListener("click", goBack); }
    overlay.addEventListener("click", function (e) { if (e.target === overlay) { close(); } });
    document.addEventListener("keydown", function (e) {
      if (overlay.hidden) { return; }
      if (e.key === "Escape") { close(); }
      else if (e.key === "Backspace" && trail.length && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || "")) {
        e.preventDefault(); goBack();
      }
    });
    function checkHash() { if (location.hash === "#make") { open(); } }
    window.addEventListener("hashchange", checkHash);
    checkHash();
  })();

  // ====================================================================
  //  THE BAR'S BRAIN  — one query/flavour layer over cocktails.json, with
  //  four faces: a natural-language finder, voice input, agent tools
  //  (WebMCP), and schema.org structured data. Each is a thin wrapper.
  // ====================================================================
  (function barBrain() {
    var BASE_EMOJI = {
      Gin: "🍸", Vodka: "🍸", Tequila: "🌵", Mezcal: "🔥", Rum: "🏝️", Whiskey: "🥃",
      Scotch: "🥃", Brandy: "🍇", Cachaça: "🌿", Pisco: "🍇", Champagne: "🥂", Prosecco: "🥂"
    };
    // Flavour vocabulary the finder understands, with everyday synonyms.
    var SYN = {
      smoky: ["smoky", "smokey", "smoke", "peaty", "peat"],
      bitter: ["bitter", "amaro", "aperitivo", "negroni"],
      sweet: ["sweet", "dessert", "sugary", "pudding"],
      sour: ["sour", "tart", "zesty", "zingy", "sharp", "citrus", "citrusy", "acidic", "tangy"],
      creamy: ["creamy", "cream", "rich", "velvety", "smooth"],
      fruity: ["fruity", "fruit", "berry", "berries"],
      tropical: ["tropical", "tiki", "beach", "holiday", "summer", "summery", "coconut"],
      spicy: ["spicy", "spice", "hot", "chili", "chilli", "heat", "fiery", "ginger"],
      refreshing: ["refreshing", "refresh", "fresh", "crisp", "cooling", "light", "thirst", "thirsty"],
      sparkling: ["sparkling", "fizzy", "fizz", "bubbly", "bubbles", "celebrate", "celebratory", "celebration"],
      strong: ["strong", "boozy", "stiff", "spirit-forward", "stirred", "serious", "potent", "spiritforward"],
      coffee: ["coffee", "espresso", "caffeine"],
      herbal: ["herbal", "herby", "botanical", "herb"],
      "long": ["long", "tall", "highball", "sessionable", "session"],
      savoury: ["savoury", "savory", "umami", "brunch"]
    };
    var BASE_SYN = {
      Gin: ["gin"], Vodka: ["vodka"], Tequila: ["tequila"], Mezcal: ["mezcal"], Rum: ["rum"],
      Whiskey: ["whiskey", "whisky", "bourbon", "rye"], Scotch: ["scotch"],
      Brandy: ["brandy", "cognac"], Cachaça: ["cachaça", "cachaca"], Pisco: ["pisco"],
      Champagne: ["champagne"], Prosecco: ["prosecco", "spritz"]
    };
    var NEGATE = ["no", "not", "without", "hold", "skip", "avoid", "less", "minus"];

    var DATA = null, tagIndex = {}, ingKeywords = {}, nameKeywords = {}, aiAvailable = false;
    // Generic words that don't usefully identify an ingredient/drink alone.
    var ING_STOP = { juice: 1, syrup: 1, liqueur: 1, bitters: 1, cream: 1, water: 1, soda: 1,
      sec: 1, puree: 1, fresh: 1, white: 1, wine: 1, brine: 1, rim: 1, twist: 1,
      cube: 1, sauce: 1, beer: 1, ale: 1, blanc: 1, dry: 1 };
    var NAME_STOP = { with: 1, and: 1, the: 1, royale: 1, cocktail: 1, twist: 1 };

    // Fold accents and lowercase, so "piña"/"pina", "crème"/"creme" all match.
    function fold(s) {
      return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
    }
    function tokens(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean); }

    // Index distinctive words of ingredients and of cocktail names.
    function buildKeywordIndexes() {
      ingKeywords = {}; nameKeywords = {};
      Object.keys(DATA.ingredients).forEach(function (name) {
        tokens(name).forEach(function (tok) {
          if (tok.length >= 4 && !ING_STOP[tok]) { (ingKeywords[tok] = ingKeywords[tok] || []).push(name); }
        });
      });
      DATA.cocktails.forEach(function (c) {
        tokens(c.name).forEach(function (tok) {
          if (tok.length >= 4 && !NAME_STOP[tok]) { (nameKeywords[tok] = nameKeywords[tok] || []).push(c.id); }
        });
      });
    }

    // Derive flavour tags for one cocktail from its structure + ingredients.
    function deriveTags(c) {
      var ing = c.ingredients, cat = DATA.ingredients, t = {};
      function any(arr) { return arr.some(function (x) { return ing.indexOf(x) !== -1; }); }
      function hasCat(k) { return ing.some(function (i) { return cat[i] === k; }); }
      function add(x) { t[x] = 1; }
      var citrus = hasCat("citrus"), juice = hasCat("juice"), top = hasCat("top"), sweet = hasCat("sweetener");
      if (!citrus && !juice && !top) { add("strong"); }
      if (top) { add("long"); add("refreshing"); }
      if (citrus) { add("sour"); }
      if (c.base === "Mezcal" || c.base === "Scotch") { add("smoky"); }
      if (c.base === "Champagne" || c.base === "Prosecco") { add("sparkling"); add("refreshing"); }
      if (any(["Campari", "Aperol", "Amaro"])) { add("bitter"); }
      if (any(["Green Chartreuse", "Yellow Chartreuse", "Bénédictine", "Absinthe", "Crème de Menthe", "Drambuie"])) { add("herbal"); }
      if (any(["Cream", "Coconut Cream", "Irish Cream", "Crème de Cacao"])) { add("creamy"); }
      if (any(["Pineapple Juice", "Passion Fruit Purée", "Coconut Cream", "Orgeat"])) { add("tropical"); }
      if (any(["Cranberry Juice", "Orange Juice", "Peach Purée", "Strawberry Purée", "Pineapple Juice", "Passion Fruit Purée", "Grenadine"])) { add("fruity"); }
      if (any(["Fresh Chili", "Hot Sauce", "Ginger Beer", "Ginger Ale", "Fresh Ginger"])) { add("spicy"); }
      if (any(["Mint", "Cucumber"])) { add("refreshing"); }
      if (any(["Champagne"])) { add("sparkling"); }
      if (any(["Coffee Liqueur", "Espresso", "Coffee"])) { add("coffee"); }
      if (any(["Tomato Juice", "Worcestershire Sauce", "Hot Sauce", "Olive Brine"])) { add("savoury"); }
      if (any(["Grenadine", "Orgeat", "Coconut Cream", "Crème de Cacao", "Irish Cream", "Coffee Liqueur", "Peach Purée", "Strawberry Purée", "Raspberry Syrup"]) || (sweet && !citrus)) { add("sweet"); }
      return Object.keys(t);
    }

    // Parse a free-text request into a scoring intent.
    function parseQuery(q) {
      var lower = q.toLowerCase();
      var words = tokens(q);
      var intent = { bases: {}, want: {}, avoid: {}, wantIng: [], avoidIng: [], names: {}, exact: {}, surprise: false, action: null };
      if (/^(add|order|get|give|pour|make me|i'?ll have|can i (get|have)) /.test(lower.trim())) { intent.action = "add"; }
      if (/\b(surprise|random|anything|whatever|dealer'?s? choice|you (choose|pick|decide))\b/.test(lower)) { intent.surprise = true; }

      function negatedAt(idx) {
        for (var k = Math.max(0, idx - 2); k < idx; k++) { if (NEGATE.indexOf(words[k]) !== -1) { return true; } }
        return false;
      }
      words.forEach(function (w, i) {
        var neg = negatedAt(i);
        var singular = w.length > 4 && w.charAt(w.length - 1) === "s" ? w.slice(0, -1) : w;
        Object.keys(SYN).forEach(function (tag) {
          if (SYN[tag].indexOf(w) !== -1) { (neg ? intent.avoid : intent.want)[tag] = 1; }
        });
        Object.keys(BASE_SYN).forEach(function (b) {
          if (BASE_SYN[b].map(fold).indexOf(w) !== -1 && !neg) { intent.bases[b] = 1; }
        });
        // Distinctive ingredient words, e.g. "elderflower", "tonic", "passion".
        var ik = ingKeywords[w] || ingKeywords[singular];
        if (ik) { ik.forEach(function (name) { (neg ? intent.avoidIng : intent.wantIng).push(name); }); }
        // Cocktail-name words, e.g. "margarita(s)", "negroni", "gibson".
        var nk = nameKeywords[w] || nameKeywords[singular];
        if (nk && !neg) { nk.forEach(function (id) { intent.names[id] = 1; }); }
      });
      // Whole-name match (accent/space-insensitive) pins the exact drink,
      // e.g. "a dirty martini" -> Dirty Martini, not Dry Martini.
      var fq = fold(q);
      if (fq.length >= 4) {
        DATA.cocktails.forEach(function (c) { if (fq.indexOf(fold(c.name)) !== -1) { intent.exact[c.id] = 1; } });
      }
      return intent;
    }

    // Score a cocktail against an intent. -Infinity means "excluded".
    function score(c, intent) {
      if (Object.keys(intent.bases).length && !intent.bases[c.base]) { return -Infinity; }
      var tags = tagIndex[c.id];
      var i;
      for (i = 0; i < intent.avoidIng.length; i++) { if (c.ingredients.indexOf(intent.avoidIng[i]) !== -1) { return -Infinity; } }
      var avoidTags = Object.keys(intent.avoid);
      for (i = 0; i < avoidTags.length; i++) { if (tags.indexOf(avoidTags[i]) !== -1) { return -Infinity; } }
      var s = 0;
      if (intent.exact[c.id]) { s += 8 + fold(c.name).length / 100; }  // whole-name match; prefer the more specific (longer) name
      else if (intent.names[c.id]) { s += 5; }    // a name-word match still ranks high
      Object.keys(intent.want).forEach(function (t) { if (tags.indexOf(t) !== -1) { s += 2; } });
      intent.wantIng.forEach(function (ing) { if (c.ingredients.indexOf(ing) !== -1) { s += 3; } });
      if (intent.bases[c.base]) { s += 1; }
      return s;
    }

    // Core search used by every face. Returns up to `n` cocktails.
    function search(intent, n) {
      n = n || 5;
      if (intent.surprise && !Object.keys(intent.want).length && !Object.keys(intent.bases).length && !intent.wantIng.length && !Object.keys(intent.names).length && !Object.keys(intent.exact).length) {
        var pool = DATA.cocktails.slice();
        for (var m = pool.length - 1; m > 0; m--) { var j = Math.floor(Math.random() * (m + 1)); var tmp = pool[m]; pool[m] = pool[j]; pool[j] = tmp; }
        return pool.slice(0, n);
      }
      var scored = DATA.cocktails.map(function (c) { return { c: c, s: score(c, intent) }; })
        .filter(function (x) { return x.s > -Infinity; });
      var anySignal = scored.some(function (x) { return x.s > 0; });
      if (!anySignal) {
        // No usable signal — return a varied sample rather than nothing.
        scored.sort(function () { return Math.random() - 0.5; });
      } else {
        scored.sort(function (a, b) { return b.s - a.s || a.c.ingredients.length - b.c.ingredients.length; });
      }
      return scored.slice(0, n).map(function (x) { return x.c; });
    }

    // Optional on-device AI (Chrome's Prompt API) to widen the intent.
    // Always falls back to the local parse; never blocks the UI for long.
    function enrichWithAI(q, intent) {
      try {
        var LM = (typeof self !== "undefined" && self.LanguageModel) ||
                 (typeof window !== "undefined" && window.ai && (window.ai.languageModel || window.ai));
        if (!LM || typeof LM.create !== "function") { return Promise.resolve(intent); }
        var vocab = Object.keys(SYN).join(", ");
        var prompt = "Flavour tags: " + vocab + ".\nFrom that list only, choose the tags that best match this drink request: \"" + q +
          "\".\nReply with ONLY a comma-separated list of matching tags, nothing else.";
        var work = LM.create().then(function (session) {
          return session.prompt(prompt).then(function (out) {
            try { session.destroy && session.destroy(); } catch (e) {}
            String(out || "").toLowerCase().split(/[,\n]/).forEach(function (raw) {
              var tag = raw.trim();
              if (SYN[tag]) { intent.want[tag] = 1; }
            });
            aiAvailable = true;
            return intent;
          });
        });
        return Promise.race([work, new Promise(function (res) { setTimeout(function () { res(intent); }, 4000); })])
          ["catch"](function () { return intent; });
      } catch (e) { return Promise.resolve(intent); }
    }

    function lineFor(c) { return { id: "ask-" + c.id, base: c.base, name: c.name, emoji: BASE_EMOJI[c.base] || "🍸" }; }

    // ---- Face 1 & 2: the Ask-the-bar finder + voice input --------------
    var section = $("askbar"), form = $("askbar-form"), input = $("askbar-input"),
        results = $("askbar-results"), micBtn = $("askbar-mic");

    function renderResults(list, q, viaVoice) {
      if (!list.length) {
        results.innerHTML = '<p class="ask-empty">No match — try “smoky”, “fruity”, “bitter”, a base spirit, or “surprise me”.</p>';
        return;
      }
      var head = aiAvailable ? '<p class="ask-head">✨ Understood with on-device AI · tap to add</p>'
                             : '<p class="ask-head">Here’s what I’d pour · tap to add</p>';
      results.innerHTML = head + list.map(function (c) {
        var tags = tagIndex[c.id].slice(0, 3).map(function (t) { return '<span class="ask-tag">' + escapeHtml(t) + "</span>"; }).join("");
        return '<div class="ask-hit">' +
            '<div class="ask-hit-main">' +
              '<span class="ask-hit-name">' + escapeHtml(c.name) + "</span> " +
              '<span class="ask-hit-base">' + (BASE_EMOJI[c.base] || "🍸") + " " + escapeHtml(c.base) + "</span>" +
              (c.blurb ? '<p class="ask-hit-blurb">' + escapeHtml(c.blurb) + "</p>" : "") +
              '<p class="ask-hit-with">' + escapeHtml([c.base].concat(c.ingredients).join(" · ")) + "</p>" +
              '<div class="ask-hit-tags">' + tags + "</div>" +
            "</div>" +
            '<button type="button" class="ask-hit-add" data-add="' + escapeHtml(c.id) + '">Add 🧺</button>' +
          "</div>";
      }).join("");
      if (viaVoice) { speak("How about a " + list[0].name + "?"); }
    }

    function runSearch(text, viaVoice) {
      var q = (text != null ? text : input.value || "").trim();
      if (!q) { q = "surprise me"; }
      var intent = parseQuery(q);
      enrichWithAI(q, intent).then(function (finalIntent) {
        var list = search(finalIntent, 5);
        // Voice "add a margarita" → drop the top match straight in.
        if (finalIntent.action === "add" && list.length) {
          addLine(lineFor(list[0]));
          results.innerHTML = '<p class="ask-head">Added a ' + escapeHtml(list[0].name) + " to your order 🧺</p>";
          if (viaVoice) { speak("Added a " + list[0].name + " to your order."); }
          return;
        }
        renderResults(list, q, viaVoice);
      });
    }

    function speak(text) {
      try {
        if (window.speechSynthesis) { var u = new SpeechSynthesisUtterance(text); window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); }
      } catch (e) {}
    }

    if (form) {
      form.addEventListener("submit", function (e) { e.preventDefault(); runSearch(null, false); });
      results.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-add]");
        if (!btn) { return; }
        var c = DATA.cocktails.filter(function (x) { return x.id === btn.getAttribute("data-add"); })[0];
        if (c) { addLine(lineFor(c)); btn.textContent = "Added ✓"; btn.disabled = true; btn.classList.add("is-added"); }
      });
    }

    // Voice input via the Web Speech API (Chrome/Safari), if present.
    function initVoice() {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR || !micBtn) { return; }
      micBtn.hidden = false;
      var listening = false, rec = null;
      micBtn.addEventListener("click", function () {
        if (listening) { try { rec.stop(); } catch (e) {} return; }
        rec = new SR(); rec.lang = "en-GB"; rec.interimResults = false; rec.maxAlternatives = 1;
        rec.onstart = function () { listening = true; micBtn.classList.add("is-listening"); input.placeholder = "Listening…"; };
        rec.onerror = function () { listening = false; micBtn.classList.remove("is-listening"); };
        rec.onend = function () { listening = false; micBtn.classList.remove("is-listening"); input.placeholder = "What are you in the mood for?"; };
        rec.onresult = function (ev) {
          var said = ev.results[0][0].transcript;
          input.value = said;
          runSearch(said, true);
        };
        try { rec.start(); } catch (e) {}
      });
    }

    // ---- Face 3: schema.org structured data for search engines/assistants
    function injectStructuredData() {
      var sections = {};
      DATA.cocktails.forEach(function (c) { (sections[c.base] = sections[c.base] || []).push(c); });
      var ld = {
        "@context": "https://schema.org", "@type": "Menu", "name": "Cocktails",
        "hasMenuSection": Object.keys(sections).map(function (base) {
          return {
            "@type": "MenuSection", "name": base,
            "hasMenuItem": sections[base].map(function (c) {
              return { "@type": "MenuItem", "name": c.name, "description": c.blurb || "",
                "menuAddOn": c.ingredients.map(function (i) { return { "@type": "MenuItem", "name": i }; }) };
            })
          };
        })
      };
      var tag = document.createElement("script");
      tag.type = "application/ld+json";
      tag.textContent = JSON.stringify(ld);
      document.head.appendChild(tag);
    }

    // ---- Face 4: WebMCP-style agent tools ------------------------------
    // Exposes the bar as callable tools. Registers with the browser's agent
    // surface if present (navigator.modelContext), and always publishes a
    // plain registry on window.barTools so it's usable/inspectable today.
    function registerTools() {
      var recipe = function (c) {
        return { name: c.name, base: c.base, ingredients: c.ingredients, garnish: c.garnish,
          ice: c.ice, glass: c.glass, blurb: c.blurb, flavours: tagIndex[c.id] };
      };
      var tools = [
        { name: "search_cocktails",
          description: "Find cocktails by free-text description, flavour, base spirit or ingredient (e.g. 'smoky, not sweet', 'a fruity rum drink').",
          inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
          handler: function (a) { var i = parseQuery(String(a && a.query || "")); return search(i, (a && a.limit) || 5).map(recipe); } },
        { name: "get_recipe",
          description: "Get the full recipe for a cocktail by name.",
          inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
          handler: function (a) { var q = String(a && a.name || "").toLowerCase(); var c = DATA.cocktails.filter(function (x) { return x.name.toLowerCase() === q; })[0] || DATA.cocktails.filter(function (x) { return x.name.toLowerCase().indexOf(q) !== -1; })[0]; return c ? recipe(c) : { error: "not found" }; } },
        { name: "recommend_cocktail",
          description: "Recommend cocktails for a mood/flavour (e.g. 'bitter aperitivo', 'creamy dessert').",
          inputSchema: { type: "object", properties: { preference: { type: "string" } }, required: ["preference"] },
          handler: function (a) { return search(parseQuery(String(a && a.preference || "")), 3).map(recipe); } },
        { name: "add_to_order",
          description: "Add a cocktail (by name) to the current order/basket.",
          inputSchema: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number" } }, required: ["name"] },
          handler: function (a) {
            var q = String(a && a.name || "").toLowerCase();
            var c = DATA.cocktails.filter(function (x) { return x.name.toLowerCase() === q; })[0] || DATA.cocktails.filter(function (x) { return x.name.toLowerCase().indexOf(q) !== -1; })[0];
            if (!c) { return { error: "no cocktail named '" + (a && a.name) + "'" }; }
            var qty = Math.max(1, Math.min(20, (a && a.quantity) || 1));
            for (var k = 0; k < qty; k++) { addLine(lineFor(c)); }
            return { added: c.name, quantity: qty };
          } },
        { name: "view_order",
          description: "List what's currently in the order/basket.",
          inputSchema: { type: "object", properties: {} },
          handler: function () { return { items: basket.map(function (l) { return { name: l.name, base: l.base, quantity: l.qty }; }) }; } },
        { name: "surprise_me",
          description: "Pick a cocktail at random (bartender's choice).",
          inputSchema: { type: "object", properties: {} },
          handler: function () { return recipe(DATA.cocktails[Math.floor(Math.random() * DATA.cocktails.length)]); } }
      ];

      // Always-on plain registry (callable today).
      window.barTools = {};
      tools.forEach(function (t) { window.barTools[t.name] = t.handler; });

      // Register with the browser agent surface if/when it exists.
      try {
        var mc = navigator.modelContext;
        if (mc) {
          if (typeof mc.registerTool === "function") {
            tools.forEach(function (t) { mc.registerTool(t); });
          } else if (typeof mc.provideContext === "function") {
            mc.provideContext({ tools: tools });
          }
          console.info("[bar] " + tools.length + " WebMCP tools registered with navigator.modelContext.");
        } else {
          console.info("[bar] WebMCP not detected; " + tools.length + " tools available on window.barTools (e.g. window.barTools.search_cocktails({query:'smoky'})).");
        }
      } catch (e) { /* non-fatal */ }
    }

    // ---- Boot: load data once, then light up all four faces ------------
    loadCocktails().then(function (data) {
      DATA = data;
      DATA.cocktails.forEach(function (c) { tagIndex[c.id] = deriveTags(c); });
      buildKeywordIndexes();
      injectStructuredData();
      registerTools();
      if (section) { section.hidden = false; }
      initVoice();
    }).catch(function () { /* leave Ask-the-bar hidden if data won't load */ });
  })();

  // ---- Background confetti cannon: emojis blast in from the edges -----
  (function buildConfetti() {
    if (reducedMotion()) { return; } // skip the whole effect for motion-sensitive users

    var ICONS = [
      "🍸", "🍹", "🍋‍🟩", "🍉", "🌶️", "🌿", "🧊", "🍊", "🫚", "🌸",
      "🥂", "🍃", "🧉", "🥃", "🫧", "🍒", "🍓", "🧂",
    ];
    // High volume — a touch lighter on small screens to stay smooth.
    var COUNT = window.innerWidth < 600 ? 80 : 110;

    var layer = document.createElement("div");
    layer.className = "confetti";
    layer.setAttribute("aria-hidden", "true");

    var rand = function (min, max) { return min + Math.random() * (max - min); };
    var html = "";

    for (var i = 0; i < COUNT; i++) {
      var icon = ICONS[Math.floor(Math.random() * ICONS.length)];

      // Launch just off a random edge of the screen (the "cannon" mouth).
      var edge = Math.floor(Math.random() * 4);
      var x0, y0;
      if (edge === 0)      { x0 = rand(0, 100);  y0 = -15; }   // top
      else if (edge === 1) { x0 = 115;           y0 = rand(0, 100); } // right
      else if (edge === 2) { x0 = rand(0, 100);  y0 = 115; }   // bottom
      else                 { x0 = -15;           y0 = rand(0, 100); } // left

      // Fire toward the interior and overshoot to the far side, with gravity bias.
      var tx = rand(20, 80), ty = rand(20, 80);
      var k = rand(1.8, 2.7);
      var x1 = x0 + (tx - x0) * k;
      var y1 = y0 + (ty - y0) * k + rand(10, 30); // sag downward as momentum dies

      var r0 = rand(0, 360);
      var r1 = r0 + (Math.random() < 0.5 ? -1 : 1) * rand(360, 1080);
      var size = rand(15, 40);
      var op = rand(0.7, 1);
      var dur = rand(2.6, 6);       // aggressive, fast crossings
      var delay = -Math.random() * dur; // negative => barrage already in progress on load

      html +=
        '<span style="font-size:' + size + "px;--x0:" + x0 + "vw;--y0:" + y0 +
        "vh;--x1:" + x1 + "vw;--y1:" + y1 + "vh;--r0:" + r0 + "deg;--r1:" + r1 +
        "deg;--op:" + op + ";animation-duration:" + dur + "s;animation-delay:" +
        delay + 's">' + icon + "</span>";
    }

    layer.innerHTML = html;
    document.body.insertBefore(layer, document.body.firstChild);
  })();
})();
