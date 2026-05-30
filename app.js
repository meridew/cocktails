/* ============================================================
   COCKTAILS — app logic
   Single source of truth (SECTIONS) drives the tabs, the cards
   AND the order basket. Add a few drinks, send them as one round.
   ============================================================ */
(function () {
  "use strict";

  // ---- Data: one place to edit drinks ----------------------------------
  var SECTIONS = [
    {
      key: "margarita",
      label: "Margaritas",
      tabEmoji: "🍹",
      tabNote: "Classic & more",
      items: [
        { name: "Margarita",                  emoji: "🍋‍🟩", ingredients: ["Tequila", "Triple Sec / Cointreau", "Lime", "Simple Syrup (opt.)", "Crushed Ice", "Salt rim"] },
        { name: "Spicy Margarita",            emoji: "🌶️",    ingredients: ["Tequila", "Triple Sec / Cointreau", "Lime", "Fresh Chili (jalapeño/red)", "Simple Syrup / Agave", "Crushed Ice", "Salt or Tajín rim"] },
        { name: "Watermelon Margarita",       emoji: "🍉",    ingredients: ["Watermelon", "Tequila", "Triple Sec / Cointreau", "Lime", "Simple Syrup (opt.)", "Crushed Ice", "Salt rim"] },
        { name: "Spicy Watermelon Margarita", emoji: "🌶️🍉",  ingredients: ["Watermelon", "Tequila", "Triple Sec / Cointreau", "Lime", "Fresh Chili (jalapeño/red)", "Simple Syrup / Agave", "Crushed Ice", "Tajín rim"] },
      ],
    },
    {
      key: "booze",
      label: "Boozy",
      tabEmoji: "🥃",
      tabNote: "Cocktails",
      items: [
        { name: "Old Fashioned", emoji: "🥃", ingredients: ["Bourbon / Rye Whiskey", "Sugar Cube", "Angostura Bitters", "Orange Peel", "Large Ice Cube", "Cocktail Cherry"] },
      ],
    },
    {
      key: "free",
      label: "Alcohol-Free",
      tabEmoji: "🌱",
      tabNote: "Mocktails",
      items: [
        { name: "Virgin Mojito",             emoji: "🌿", ingredients: ["Fresh Mint", "Lime", "Simple Syrup / Sugar", "Sparkling Mineral Water", "Crushed Ice"] },
        { name: "Virgin Moscow Mule",        emoji: "🫚", ingredients: ["Ginger Beer", "Lime", "Fresh Ginger (opt.)", "Crushed Ice"] },
        { name: "Pomegranate & Elderflower", emoji: "🌸", ingredients: ["Fresh Mint", "Lime", "Pomegranate Juice", "Elderflower Cordial", "Sparkling Mineral Water", "Crushed Ice"] },
      ],
    },
  ];

  var NAME_KEY = "cocktail_name";
  var $ = function (id) { return document.getElementById(id); };

  var form       = $("request-form");
  var formCard   = $("order-form");
  var nameInput  = $("name");
  var statusEl   = $("status");
  var submitBtn  = $("submit-btn");
  var basketEl   = $("basket");
  var orderField = $("order-field");
  var tabsEl     = $("tabs");
  var panelsEl   = $("panels");

  // floating basket pill
  var pill      = $("basket-pill");
  var pillCount = $("basket-pill-count");

  // success overlay
  var overlay       = $("celebrate");
  var overlayTitle  = $("celebrate-title");
  var overlayMsg    = $("celebrate-msg");
  var overlayBurst  = $("celebrate-burst");
  var orderAgainBtn = $("order-again");

  function reducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Stable id for a drink, e.g. "Spicy Margarita (Margaritas)"
  function drinkId(item, section) { return item.name + " (" + section.label + ")"; }

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
    if (line.qty <= 0) {
      basket = basket.filter(function (l) { return l.id !== id; });
    }
    renderBasket();
  }
  function totalCount() {
    return basket.reduce(function (n, l) { return n + l.qty; }, 0);
  }
  function orderSummary() {
    return basket.map(function (l) { return l.qty + "× " + l.name; }).join(", ");
  }

  function renderBasket() {
    var count = totalCount();

    if (!basket.length) {
      basketEl.innerHTML =
        '<p class="basket-empty">Your order is empty — tap <strong>Add to order</strong> on any drink above. 🍸</p>';
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

    // Send button reflects the running count.
    submitBtn.disabled = count === 0;
    submitBtn.textContent = count === 0
      ? "Add a drink first"
      : "Send " + count + (count === 1 ? " drink 🍹" : " drinks 🍹");

    pillCount.textContent = count;
    orderField.value = orderSummary();
    updatePillVisibility();
  }

  // Basket controls (event-delegated so they survive re-renders).
  basketEl.addEventListener("click", function (e) {
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

  // ---- Build tabs, panels and cards from the data -----------------------
  var tabRefs = []; // [{ btn, panel }]

  SECTIONS.forEach(function (section, index) {
    var first = index === 0;

    // Tab button
    var btn = document.createElement("button");
    btn.className = "tab";
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.id = "tab-" + section.key;
    btn.setAttribute("aria-controls", "panel-" + section.key);
    btn.setAttribute("aria-selected", first ? "true" : "false");
    btn.tabIndex = first ? 0 : -1;
    btn.innerHTML = section.tabEmoji + " " + section.label + "<small>" + section.tabNote + "</small>";
    tabsEl.appendChild(btn);

    // Panel + menu grid
    var panel = document.createElement("section");
    panel.className = "panel" + (first ? " active" : "");
    panel.id = "panel-" + section.key;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", btn.id);
    panel.hidden = !first;

    var menu = document.createElement("div");
    menu.className = "menu";

    section.items.forEach(function (item) {
      var card = document.createElement("article");
      card.className = "cocktail";
      var chips = item.ingredients
        .map(function (i) { return "<li>" + escapeHtml(i) + "</li>"; })
        .join("");
      card.innerHTML =
        '<h3><span class="emoji">' + item.emoji + "</span>" + escapeHtml(item.name) + "</h3>" +
        '<ul class="ingredients">' + chips + "</ul>" +
        '<button type="button" class="order">Add to order +</button>';
      var addBtn = card.querySelector(".order");
      addBtn.addEventListener("click", function () {
        addToBasket(item, section);
        flashAdded(addBtn);
      });
      menu.appendChild(card);
    });

    panel.appendChild(menu);
    panelsEl.appendChild(panel);

    tabRefs.push({ btn: btn, panel: panel });
  });

  // ---- Tabs behaviour (click + arrow keys) ------------------------------
  function selectTab(index, focusBtn) {
    tabRefs.forEach(function (t, i) {
      var on = i === index;
      t.btn.setAttribute("aria-selected", on ? "true" : "false");
      t.btn.tabIndex = on ? 0 : -1;
      t.panel.classList.toggle("active", on);
      t.panel.hidden = !on;
    });
    if (focusBtn) { tabRefs[index].btn.focus(); }
  }
  tabRefs.forEach(function (t, i) {
    t.btn.addEventListener("click", function () { selectTab(i, false); });
    t.btn.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        selectTab((i + (e.key === "ArrowRight" ? 1 : tabRefs.length - 1)) % tabRefs.length, true);
      } else if (e.key === "Home") {
        e.preventDefault(); selectTab(0, true);
      } else if (e.key === "End") {
        e.preventDefault(); selectTab(tabRefs.length - 1, true);
      }
    });
  });

  // ---- Floating pill: jumps to the order, hides once it's in view -------
  var orderInView = false;
  function updatePillVisibility() {
    var count = totalCount();
    pill.hidden = count === 0 || orderInView;
    pill.setAttribute("aria-label",
      "View your order — " + count + (count === 1 ? " drink" : " drinks"));
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
    var saved = localStorage.getItem(NAME_KEY);
    if (saved) { nameInput.value = saved; }
  } catch (e) { /* private mode / blocked storage — ignore */ }

  function rememberName() {
    try { localStorage.setItem(NAME_KEY, nameInput.value.trim()); } catch (e) { /* ignore */ }
  }
  nameInput.addEventListener("change", rememberName);

  // ---- Submit the whole basket via AJAX --------------------------------
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!basket.length) {
      statusEl.className = "status err";
      statusEl.textContent = "ADD A DRINK FIRST!";
      return;
    }
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
        var orderedCount = totalCount();
        basket = [];
        renderBasket();           // clears the list + disables the button
        form.reset();
        nameInput.value = orderedName; // keep their name for the next round
        statusEl.className = "status";
        statusEl.textContent = "";
        celebrate(orderedName, orderedLines, orderedCount);
      })
      .catch(function () {
        statusEl.className = "status err";
        statusEl.textContent = "OOPS — try that again!";
        submitBtn.disabled = false;
      });
  });

  // ---- Success celebration --------------------------------------------
  function celebrate(name, lines, count) {
    overlayTitle.textContent = name ? "Cheers, " + name + "! 🥂" : "Cheers! 🥂";
    var list = lines
      .map(function (l) { return "<li>" + l.qty + "× " + escapeHtml(l.name) + "</li>"; })
      .join("");
    overlayMsg.innerHTML =
      "Your <strong>" + count + (count === 1 ? " drink" : " drinks") + "</strong> " +
      (count === 1 ? "is" : "are") + " on the way. 🍹" +
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
    if (tabRefs[0]) { tabRefs[0].btn.focus(); } // back at the top, ready for more
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
