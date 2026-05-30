/* ============================================================
   COCKTAILS — app logic
   One data source (SECTIONS) drives the chip nav, the menu, the
   order basket, favourites, re-ordering and the theme switcher.
   Boozy drinks open a shared "customise" sheet; everything else
   is a one-tap add.
   ============================================================ */
(function () {
  "use strict";

  var THEMES = ["neon", "tiki", "speakeasy"];
  var THEME_LABELS = { neon: "Neon", tiki: "Tiki", speakeasy: "Speakeasy" };

  // Shared option block: every boozy drink offers the same strength choice.
  var STRENGTH_OPT = {
    key: "strength", label: "Strength",
    choices: [
      { value: "Single", label: "Single", tag: "Single" },
      { value: "Double", label: "Double", tag: "Double", adds: ["Extra shot"] },
    ],
  };

  // Shared option block: glassware. Short = tumbler / rocks, Long = highball.
  // Offered on every drink except the Old Fashioned (always served short).
  var SERVE_OPT = {
    key: "serve", label: "Serve",
    choices: [
      { value: "Short", label: "Short", emoji: "🥃", tag: "Short", adds: ["Tumbler"] },
      { value: "Long",  label: "Long",  emoji: "🥤", tag: "Long",  adds: ["Highball glass"] },
    ],
  };

  // ---- Data: one place to edit the menu --------------------------------
  // Items with `options` open the customise sheet; the rest are quick-add.
  var SECTIONS = [
    {
      key: "margarita", label: "Margaritas", emoji: "🍹",
      items: [
        {
          name: "Margarita", emoji: "🍹",
          baseIngredients: ["Tequila", "Triple Sec / Cointreau", "Lime", "Crushed Ice", "Salt rim"],
          options: [
            { key: "base", label: "Base", choices: [
              { value: "Regular",    label: "Regular",    emoji: "🍋‍🟩", tag: "Regular" },
              { value: "Watermelon", label: "Watermelon", emoji: "🍉",   tag: "Watermelon", adds: ["Watermelon"] },
            ] },
            { key: "spicy", label: "Spice", choices: [
              { value: "No",    label: "No" },
              { value: "Spicy", label: "Spicy", emoji: "🌶️", tag: "Spicy", adds: ["Fresh Chili"] },
            ] },
            STRENGTH_OPT,
            SERVE_OPT,
          ],
        },
      ],
    },
    {
      key: "booze", label: "Boozy", emoji: "🥃",
      items: [
        {
          name: "Old Fashioned", emoji: "🥃",
          baseIngredients: ["Bourbon / Rye Whiskey", "Sugar Cube", "Angostura Bitters", "Orange Peel", "Large Ice Cube"],
          options: [STRENGTH_OPT],
        },
      ],
    },
    {
      key: "free", label: "Alcohol-Free", emoji: "🌱",
      items: [
        { name: "Virgin Mojito",             emoji: "🌿", baseIngredients: ["Fresh Mint", "Lime", "Sugar", "Soda Water", "Crushed Ice"],            options: [SERVE_OPT] },
        { name: "Virgin Moscow Mule",        emoji: "🫚", baseIngredients: ["Ginger Beer", "Lime", "Fresh Ginger", "Crushed Ice"],                  options: [SERVE_OPT] },
        { name: "Pom & Elderflower", emoji: "🌸", baseIngredients: ["Pomegranate Juice", "Elderflower Cordial", "Lime", "Soda Water", "Ice"], options: [SERVE_OPT] },
      ],
    },
    {
      key: "wine", label: "Wine", emoji: "🍷",
      items: [
        {
          name: "Wine", emoji: "🍷",
          baseIngredients: ["House wine"],
          options: [
            { key: "colour", label: "Colour", choices: [
              { value: "White", label: "White", emoji: "🤍", tag: "White" },
              { value: "Red",   label: "Red",   emoji: "❤️", tag: "Red" },
              { value: "Rosé",  label: "Rosé",  emoji: "🩷", tag: "Rosé" },
            ] },
            // Ice only makes sense for white & rosé — hidden for red.
            { key: "ice", label: "Ice", showIf: function (c) { return c.colour === "White" || c.colour === "Rosé"; },
              choices: [
                { value: "1 cube",  label: "1 cube",  emoji: "🧊", tag: "1 cube",  adds: ["1 ice cube"] },
                { value: "2 cubes", label: "2 cubes", emoji: "🧊", tag: "2 cubes", adds: ["2 ice cubes"] },
              ] },
          ],
        },
      ],
    },
    {
      key: "food", label: "Food", emoji: "🍔",
      items: [
        { name: "Chicken", emoji: "🍗" },
        { name: "Lamb",    emoji: "🍖" },
        { name: "Burger",  emoji: "🍔" },
        { name: "Chocolate Cake", emoji: "🍰" },
      ],
    },
  ];

  // ---- Storage keys + element refs -------------------------------------
  var NAME_KEY  = "cocktail_name";
  var FAV_KEY   = "cocktail_favs";
  var LAST_KEY  = "cocktail_last_order";
  var THEME_KEY = "cocktail_theme";
  var ORDERS_KEY = "cocktail_orders";

  var $ = function (id) { return document.getElementById(id); };

  var form       = $("request-form");
  var formCard   = $("order-form");
  var nameInput  = $("name");
  var statusEl   = $("status");
  var submitBtn  = $("submit-btn");
  var basketEl   = $("basket");
  var orderField = $("order-field");
  var sectionsEl = $("menu-sections");
  var surpriseBtn = $("surprise");
  var themeBtn    = $("theme-btn");

  var pill      = $("basket-pill");
  var pillCount = $("basket-pill-count");

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

  // Stable id for a base item, e.g. "Margarita (Margaritas)"
  function baseId(item, section) { return item.name + " (" + section.label + ")"; }
  function isCustomisable(item) { return item.options && item.options.length; }
  function findChoice(opt, val) {
    for (var i = 0; i < opt.choices.length; i++) { if (opt.choices[i].value === val) { return opt.choices[i]; } }
    return opt.choices[0];
  }
  // Options can declare showIf(config) to appear only for certain choices
  // (e.g. wine's ice option only for White/Rosé). Inactive options are
  // ignored when building the line, recipe and ticket.
  function activeOptions(item, config) {
    return (item.options || []).filter(function (opt) { return !opt.showIf || opt.showIf(config); });
  }

  // Index every base item by id (for favourites + re-order validation).
  var itemIndex = {};
  SECTIONS.forEach(function (section) {
    section.items.forEach(function (item) { itemIndex[baseId(item, section)] = { item: item, section: section }; });
  });

  // ---- Favourites + last order (persisted) -----------------------------
  var favs = lsJSON(FAV_KEY);
  function isFav(id) { return favs.indexOf(id) !== -1; }

  var lastOrder = lsJSON(LAST_KEY).filter(function (l) { return itemIndex[l.base || l.id]; });

  // ---- Order line builders ---------------------------------------------
  // A line: { id, base, name, emoji, qty }. `id` encodes the config so
  // identical configs stack and different ones stay separate.
  function lineForQuick(item, section) {
    var id = baseId(item, section);
    return { id: id, base: id, name: item.name, emoji: item.emoji };
  }
  function lineForConfig(item, section, config) {
    var base = baseId(item, section);
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
      var html = '<p class="basket-empty">Your order is empty — tap <strong>Add to order</strong> on anything above. 🍸</p>';
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

    pillCount.textContent = count;
    orderField.value = orderSummary();
    updatePillVisibility();
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

  // Brief "Added ✓" confirmation on a quick-add button.
  function flashAdded(btn) {
    btn.classList.add("added");
    btn.textContent = "Added ✓";
    clearTimeout(btn._addedTimer);
    btn._addedTimer = setTimeout(function () {
      btn.classList.remove("added");
      btn.textContent = "Add to order +";
    }, 1100);
  }

  function bumpPill() {
    if (reducedMotion()) { return; }
    pill.classList.remove("bump");
    void pill.offsetWidth; // restart the animation
    pill.classList.add("bump");
  }

  // ---- Build a menu card (used by both the menu and favourites) --------
  function buildCard(item, section) {
    var id = baseId(item, section);
    var card = document.createElement("article");
    card.className = "cocktail";
    card.setAttribute("data-id", id);

    var faved = isFav(id);
    var custom = isCustomisable(item);

    card.innerHTML =
      '<button type="button" class="fav" data-fav-id="' + escapeHtml(id) + '" aria-pressed="' + (faved ? "true" : "false") +
        '" aria-label="' + (faved ? "Remove " : "Save ") + escapeHtml(item.name) + ' to favourites">' + (faved ? "★" : "☆") + "</button>" +
      '<h3><span class="emoji">' + item.emoji + "</span>" + escapeHtml(item.name) + "</h3>" +
      '<button type="button" class="order">' + (custom ? "Customise →" : "Add to order +") + "</button>";

    var orderBtn = card.querySelector(".order");
    if (custom) {
      orderBtn.addEventListener("click", function () { openCustomise(item, section, orderBtn); });
    } else {
      orderBtn.addEventListener("click", function () { addLine(lineForQuick(item, section)); flashAdded(orderBtn); });
    }
    card.querySelector(".fav").addEventListener("click", function () { toggleFav(id); });
    return card;
  }

  // ---- Customise sheet --------------------------------------------------
  var czItem = null, czSection = null, czConfig = {}, czTrigger = null;

  function openCustomise(item, section, trigger) {
    czItem = item;
    czSection = section;
    czTrigger = trigger || null;
    czConfig = {};
    item.options.forEach(function (opt) { czConfig[opt.key] = opt.choices[0].value; }); // defaults

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
    addLine(lineForConfig(czItem, czSection, czConfig));
    closeCustomise();
  });
  czClose.addEventListener("click", closeCustomise);
  sheet.addEventListener("click", function (e) { if (e.target === sheet) { closeCustomise(); } });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !sheet.hidden) { closeCustomise(); }
  });

  // ---- Favourites -------------------------------------------------------
  var favSection, favMenu;

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
    renderFavourites();
  }

  function renderFavourites() {
    var refs = favs.map(function (id) { return itemIndex[id]; }).filter(Boolean);
    var has = refs.length > 0;
    favSection.hidden = !has;
    favMenu.innerHTML = "";
    refs.forEach(function (r) { favMenu.appendChild(buildCard(r.item, r.section)); });
  }

  // ---- Build the full menu (sections stacked top to bottom) ------------
  function buildSection(key, emoji, label) {
    var sec = document.createElement("section");
    sec.className = "menu-section";
    sec.id = "section-" + key;
    sec.setAttribute("aria-label", label);
    var head = document.createElement("h2");
    head.className = "section-head";
    head.innerHTML = '<span class="emoji" aria-hidden="true">' + emoji + "</span>" + label;
    var menu = document.createElement("div");
    menu.className = "menu";
    sec.appendChild(head);
    sec.appendChild(menu);
    sectionsEl.appendChild(sec);
    return { sec: sec, menu: menu };
  }

  // Favourites lives first (shown only once you've starred something).
  var favBuilt = buildSection("favourites", "⭐", "Your Favourites");
  favSection = favBuilt.sec;
  favMenu = favBuilt.menu;

  SECTIONS.forEach(function (section) {
    var built = buildSection(section.key, section.emoji, section.label);
    section.items.forEach(function (item) { built.menu.appendChild(buildCard(item, section)); });
  });

  renderFavourites();

  // ---- 🎲 Bartender's choice: add a random drink (rolls options too) ---
  surpriseBtn.addEventListener("click", function () {
    var pool = [];
    SECTIONS.forEach(function (section) {
      if (section.key === "food") { return; } // bartender pours drinks, not dinner
      section.items.forEach(function (item) { pool.push({ item: item, section: section }); });
    });
    if (!pool.length) { return; }
    var pick = pool[Math.floor(Math.random() * pool.length)];
    var item = pick.item, section = pick.section;

    if (isCustomisable(item)) {
      var config = {};
      item.options.forEach(function (opt) { config[opt.key] = opt.choices[Math.floor(Math.random() * opt.choices.length)].value; });
      addLine(lineForConfig(item, section, config));
    } else {
      addLine(lineForQuick(item, section));
    }

    if (!reducedMotion()) {
      surpriseBtn.classList.remove("spin");
      void surpriseBtn.offsetWidth;
      surpriseBtn.classList.add("spin");
    }

    var card = document.querySelector("#section-" + section.key + ' [data-id="' + baseId(item, section) + '"]');
    if (card) {
      card.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
      if (!isCustomisable(item)) { flashAdded(card.querySelector(".order")); }
      card.classList.remove("just-picked");
      void card.offsetWidth;
      card.classList.add("just-picked");
    }
  });

  // ---- 🎨 Theme switcher ------------------------------------------------
  function applyTheme(name) {
    if (THEMES.indexOf(name) === -1) { name = "neon"; }
    document.documentElement.setAttribute("data-theme", name);
    lsSet(THEME_KEY, name);
    themeBtn.setAttribute("aria-label", "Theme: " + THEME_LABELS[name] + " — tap to change");
    themeBtn.title = "Theme: " + THEME_LABELS[name];
  }
  applyTheme(lsGet(THEME_KEY) || "neon");
  themeBtn.addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme") || "neon";
    applyTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
    if (!reducedMotion()) {
      themeBtn.classList.remove("pop");
      void themeBtn.offsetWidth;
      themeBtn.classList.add("pop");
    }
  });

  // ---- Floating pill: jumps to the order, hides once it's in view ------
  var orderInView = false;
  function updatePillVisibility() {
    var count = totalCount();
    pill.hidden = count === 0 || orderInView;
    pill.setAttribute("aria-label", "View your order — " + count + (count === 1 ? " item" : " items"));
  }
  pill.addEventListener("click", function () {
    formCard.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    if (!nameInput.value.trim()) { nameInput.focus({ preventScroll: true }); }
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      orderInView = entries[0].isIntersecting;
      updatePillVisibility();
    }, { threshold: 0.25 }).observe(formCard);
  }

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

    fetch(form.action, {
      method: "POST",
      body: new FormData(form),
      headers: { Accept: "application/json" },
    })
      .then(function (res) {
        if (!res.ok) { throw new Error("Bad response"); }
        var orderedName = nameInput.value.trim();
        var orderedLines = basket.slice();
        var orderedNote = ($("note").value || "").trim();
        lastOrder = orderedLines.slice();
        lsSet(LAST_KEY, JSON.stringify(lastOrder));
        saveOrderRecord(orderedName, orderedLines, orderedNote);
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

  function renderOrders() {
    var orders = getOrders().slice().sort(function (a, b) { return b.ts - a.ts; });
    var pending = orders.filter(function (o) { return o.status !== "done"; });
    var view = btShowDone.checked ? orders : pending;

    btTitle.textContent = "🍸 Bartender" + (pending.length ? " (" + pending.length + ")" : "");

    if (!view.length) {
      bartenderList.innerHTML = '<p class="bt-empty">' +
        (btShowDone.checked ? "No orders saved on this device yet." : "No pending orders. 🎉") + "</p>";
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

  bartenderList.addEventListener("click", function (e) {
    var doneBtn = e.target.closest(".bt-toggle-done");
    var delBtn = e.target.closest(".bt-del");
    if (doneBtn) {
      var id = doneBtn.getAttribute("data-id");
      var orders = getOrders();
      orders.forEach(function (o) { if (o.id === id) { o.status = (o.status === "done") ? "pending" : "done"; } });
      setOrders(orders);
      renderOrders();
    } else if (delBtn) {
      setOrders(getOrders().filter(function (o) { return o.id !== delBtn.getAttribute("data-id"); }));
      renderOrders();
    }
  });

  function openBartender() {
    bartender.hidden = false;
    document.body.style.overflow = "hidden";
    renderOrders();
    btClose.focus();
  }
  function closeBartender() {
    bartender.hidden = true;
    document.body.style.overflow = "";
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
  btShowDone.addEventListener("change", renderOrders);
  btExport.addEventListener("click", exportOrders);
  btClear.addEventListener("click", function () {
    setOrders(getOrders().filter(function (o) { return o.status !== "done"; }));
    renderOrders();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !bartender.hidden) { closeBartender(); }
  });
  function checkBartenderHash() { if (location.hash === "#bartender") { openBartender(); } }
  window.addEventListener("hashchange", checkBartenderHash);
  checkBartenderHash();

  // Paint the (empty) basket once at startup.
  renderBasket();

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
