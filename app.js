/* ============================================================
   COCKTAILS — app logic
   One data source (SECTIONS) drives the chip nav, the menu, the
   order basket, favourites, re-ordering and the theme switcher.
   ============================================================ */
(function () {
  "use strict";

  // ---- Tag + theme vocabularies ----------------------------------------
  var TAGS = {
    spicy:  { emoji: "🌶️", label: "Spicy" },
    fruity: { emoji: "🍓", label: "Fruity" },
    strong: { emoji: "🔥", label: "Strong" },
    zero:   { emoji: "🌱", label: "0%" },
  };
  var THEMES = ["neon", "tiki", "speakeasy"];
  var THEME_LABELS = { neon: "Neon", tiki: "Tiki", speakeasy: "Speakeasy" };

  // ---- Data: one place to edit the menu --------------------------------
  var SECTIONS = [
    {
      key: "margarita", label: "Margaritas", emoji: "🍹",
      items: [
        { name: "Margarita",                  emoji: "🍋‍🟩", strength: 3, tags: [],                 ingredients: ["Tequila", "Triple Sec / Cointreau", "Lime", "Simple Syrup (opt.)", "Crushed Ice", "Salt rim"] },
        { name: "Spicy Margarita",            emoji: "🌶️",   strength: 3, tags: ["spicy"],          ingredients: ["Tequila", "Triple Sec / Cointreau", "Lime", "Fresh Chili (jalapeño/red)", "Simple Syrup / Agave", "Crushed Ice", "Salt or Tajín rim"] },
        { name: "Watermelon Margarita",       emoji: "🍉",    strength: 2, tags: ["fruity"],         ingredients: ["Watermelon", "Tequila", "Triple Sec / Cointreau", "Lime", "Simple Syrup (opt.)", "Crushed Ice", "Salt rim"] },
        { name: "Spicy Watermelon Margarita", emoji: "🌶️🍉", strength: 3, tags: ["spicy", "fruity"], ingredients: ["Watermelon", "Tequila", "Triple Sec / Cointreau", "Lime", "Fresh Chili (jalapeño/red)", "Simple Syrup / Agave", "Crushed Ice", "Tajín rim"] },
      ],
    },
    {
      key: "booze", label: "Boozy", emoji: "🥃",
      items: [
        { name: "Old Fashioned", emoji: "🥃", strength: 5, tags: ["strong"], ingredients: ["Bourbon / Rye Whiskey", "Sugar Cube", "Angostura Bitters", "Orange Peel", "Large Ice Cube", "Cocktail Cherry"] },
      ],
    },
    {
      key: "free", label: "Alcohol-Free", emoji: "🌱",
      items: [
        { name: "Virgin Mojito",             emoji: "🌿", strength: 0, tags: ["zero"], ingredients: ["Fresh Mint", "Lime", "Simple Syrup / Sugar", "Sparkling Mineral Water", "Crushed Ice"] },
        { name: "Virgin Moscow Mule",        emoji: "🫚", strength: 0, tags: ["zero"], ingredients: ["Ginger Beer", "Lime", "Fresh Ginger (opt.)", "Crushed Ice"] },
        { name: "Pomegranate & Elderflower", emoji: "🌸", strength: 0, tags: ["zero"], ingredients: ["Fresh Mint", "Lime", "Pomegranate Juice", "Elderflower Cordial", "Sparkling Mineral Water", "Crushed Ice"] },
      ],
    },
    {
      key: "food", label: "Food", emoji: "🍔",
      items: [
        { name: "Chicken", emoji: "🍗", strength: 0, tags: [], ingredients: ["Grilled Chicken", "Lemon & Herbs", "Fries", "Slaw"] },
        { name: "Lamb",    emoji: "🍖", strength: 0, tags: [], ingredients: ["Slow-Cooked Lamb", "Rosemary", "Roast Potatoes", "Mint Sauce"] },
        { name: "Burger",  emoji: "🍔", strength: 0, tags: [], ingredients: ["Beef Patty", "Cheese", "Lettuce & Tomato", "Brioche Bun", "Fries"] },
      ],
    },
  ];

  // ---- Storage keys + element refs -------------------------------------
  var NAME_KEY  = "cocktail_name";
  var FAV_KEY   = "cocktail_favs";
  var LAST_KEY  = "cocktail_last_order";
  var THEME_KEY = "cocktail_theme";

  var $ = function (id) { return document.getElementById(id); };

  var form       = $("request-form");
  var formCard   = $("order-form");
  var nameInput  = $("name");
  var statusEl   = $("status");
  var submitBtn  = $("submit-btn");
  var basketEl   = $("basket");
  var orderField = $("order-field");
  var chipbar    = $("chipbar");
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

  // Stable id for an item, e.g. "Spicy Margarita (Margaritas)"
  function drinkId(item, section) { return item.name + " (" + section.label + ")"; }

  // Index every item by id (for favourites + re-order lookups).
  var itemIndex = {};
  SECTIONS.forEach(function (section) {
    section.items.forEach(function (item) { itemIndex[drinkId(item, section)] = { item: item, section: section }; });
  });

  // ---- Favourites + last order (persisted) -----------------------------
  var favs = lsJSON(FAV_KEY);
  function isFav(id) { return favs.indexOf(id) !== -1; }

  var lastOrder = lsJSON(LAST_KEY).filter(function (l) { return itemIndex[l.id]; });

  // ---- The order basket -------------------------------------------------
  var basket = []; // [{ id, name, emoji, qty }]

  function findLine(id) {
    for (var i = 0; i < basket.length; i++) { if (basket[i].id === id) { return basket[i]; } }
    return null;
  }
  function addToBasket(item, section) {
    var id = drinkId(item, section);
    var line = findLine(id);
    if (line) { line.qty++; }
    else { basket.push({ id: id, name: item.name, emoji: item.emoji, qty: 1 }); }
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
      basket = lastOrder.map(function (l) { return { id: l.id, name: l.name, emoji: l.emoji, qty: l.qty }; });
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

  // Brief "Added ✓" confirmation right where the user tapped.
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
    var id = drinkId(item, section);
    var card = document.createElement("article");
    card.className = "cocktail";
    card.setAttribute("data-id", id);

    var tagsHtml = (item.tags || []).map(function (t) {
      var def = TAGS[t];
      return def ? '<span class="tag">' + def.emoji + " " + def.label + "</span>" : "";
    }).join("");

    var strengthHtml = "";
    if (item.strength >= 1) {
      var dots = "";
      for (var s = 1; s <= 5; s++) { dots += '<i class="' + (s <= item.strength ? "on" : "") + '"></i>'; }
      strengthHtml = '<span class="strength" aria-label="Strength ' + item.strength + ' of 5" title="Strength">' + dots + "</span>";
    }
    var metaHtml = (tagsHtml || strengthHtml) ? '<div class="meta">' + tagsHtml + strengthHtml + "</div>" : "";

    var chips = item.ingredients.map(function (i) { return "<li>" + escapeHtml(i) + "</li>"; }).join("");
    var faved = isFav(id);

    card.innerHTML =
      '<button type="button" class="fav" data-fav-id="' + escapeHtml(id) + '" aria-pressed="' + (faved ? "true" : "false") +
        '" aria-label="' + (faved ? "Remove " : "Save ") + escapeHtml(item.name) + ' to favourites">' + (faved ? "★" : "☆") + "</button>" +
      '<h3><span class="emoji">' + item.emoji + "</span>" + escapeHtml(item.name) + "</h3>" +
      metaHtml +
      '<ul class="ingredients">' + chips + "</ul>" +
      '<button type="button" class="order">Add to order +</button>';

    var orderBtn = card.querySelector(".order");
    orderBtn.addEventListener("click", function () {
      addToBasket(item, section);
      flashAdded(orderBtn);
    });
    card.querySelector(".fav").addEventListener("click", function () { toggleFav(id); });
    return card;
  }

  // ---- Favourites -------------------------------------------------------
  var favSection, favMenu, favChip;

  function toggleFav(id) {
    var i = favs.indexOf(id);
    if (i === -1) { favs.push(id); } else { favs.splice(i, 1); }
    lsSet(FAV_KEY, JSON.stringify(favs));

    // Sync every star button for this id (it can appear twice: menu + favourites).
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
    favChip.hidden = !has;
    favMenu.innerHTML = "";
    refs.forEach(function (r) { favMenu.appendChild(buildCard(r.item, r.section)); });
  }

  // ---- Build chip nav + the full menu ----------------------------------
  var chipRefs = []; // [{ key, chip, sec }]

  function buildChip(key, emoji, label) {
    var chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.innerHTML = '<span class="emoji" aria-hidden="true">' + emoji + "</span>" + label;
    chip.addEventListener("click", function () {
      var sec = $("section-" + key);
      if (sec) { sec.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }); }
    });
    chipbar.appendChild(chip);
    return chip;
  }
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
  favChip = buildChip("favourites", "⭐", "Favourites");
  var favBuilt = buildSection("favourites", "⭐", "Your Favourites");
  favSection = favBuilt.sec;
  favMenu = favBuilt.menu;
  chipRefs.push({ key: "favourites", chip: favChip, sec: favSection });

  SECTIONS.forEach(function (section) {
    var chip = buildChip(section.key, section.emoji, section.label);
    var built = buildSection(section.key, section.emoji, section.label);
    section.items.forEach(function (item) { built.menu.appendChild(buildCard(item, section)); });
    chipRefs.push({ key: section.key, chip: chip, sec: built.sec });
  });

  renderFavourites();

  // ---- Scroll-spy: highlight the chip for the section you're in --------
  if ("IntersectionObserver" in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) { return; }
        var id = en.target.id;
        chipRefs.forEach(function (r) {
          r.chip.setAttribute("aria-current", ("section-" + r.key) === id ? "true" : "false");
        });
      });
    }, { rootMargin: "-72px 0px -65% 0px", threshold: 0 });
    chipRefs.forEach(function (r) { spy.observe(r.sec); });
  }

  // ---- 🎲 Bartender's choice: add a random drink -----------------------
  surpriseBtn.addEventListener("click", function () {
    var pool = [];
    SECTIONS.forEach(function (section) {
      if (section.key === "food") { return; } // bartender pours drinks, not dinner
      section.items.forEach(function (item) { pool.push({ item: item, section: section }); });
    });
    if (!pool.length) { return; }
    var pick = pool[Math.floor(Math.random() * pool.length)];
    addToBasket(pick.item, pick.section);

    if (!reducedMotion()) {
      surpriseBtn.classList.remove("spin");
      void surpriseBtn.offsetWidth;
      surpriseBtn.classList.add("spin");
    }

    var id = drinkId(pick.item, pick.section);
    var card = document.querySelector("#section-" + pick.section.key + ' [data-id="' + id + '"]');
    if (card) {
      card.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
      var ob = card.querySelector(".order");
      if (ob) { flashAdded(ob); }
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
        // Remember this order so it can be re-ordered next time.
        lastOrder = orderedLines.slice();
        lsSet(LAST_KEY, JSON.stringify(lastOrder));
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
    if (chipRefs.length) { chipRefs[0].chip.focus(); } // back at the top
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
