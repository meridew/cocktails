/* ============================================================
   COCKTAILS — app logic
   Single source of truth (MENU) drives the cards AND the dropdown.
   ============================================================ */
(function () {
  "use strict";

  // ---- Data: one place to edit drinks ----------------------------------
  var SECTIONS = [
    {
      key: "booze",
      label: "Boozy",
      items: [
        { name: "Margarita",            emoji: "🍋‍🟩", ingredients: ["Tequila", "Triple Sec / Cointreau", "Lime", "Simple Syrup (opt.)", "Crushed Ice", "Salt rim"] },
        { name: "Spicy Margarita",      emoji: "🌶️", ingredients: ["Tequila", "Triple Sec / Cointreau", "Lime", "Fresh Chili (jalapeño/red)", "Simple Syrup / Agave", "Crushed Ice", "Salt or Tajín rim"] },
        { name: "Watermelon Margarita", emoji: "🍉", ingredients: ["Watermelon", "Tequila", "Triple Sec / Cointreau", "Lime", "Simple Syrup (opt.)", "Crushed Ice", "Salt rim"] },
        { name: "Old Fashioned",        emoji: "🥃", ingredients: ["Bourbon / Rye Whiskey", "Sugar Cube", "Angostura Bitters", "Orange Peel", "Large Ice Cube", "Cocktail Cherry"] },
      ],
    },
    {
      key: "free",
      label: "Alcohol-Free",
      items: [
        { name: "Virgin Mojito",        emoji: "🌿", ingredients: ["Fresh Mint", "Lime", "Simple Syrup / Sugar", "Sparkling Mineral Water", "Crushed Ice"] },
        { name: "Virgin Moscow Mule",   emoji: "🫚", ingredients: ["Ginger Beer", "Lime", "Fresh Ginger (opt.)", "Crushed Ice"] },
        { name: "Nojito + Elderflower", emoji: "🌸", ingredients: ["Fresh Mint", "Lime", "Elderflower Cordial", "Sparkling Mineral Water", "Crushed Ice"] },
      ],
    },
  ];

  var NAME_KEY = "cocktail_name";
  var $ = function (id) { return document.getElementById(id); };

  var select   = $("cocktail");
  var form     = $("request-form");
  var formCard = $("order-form");
  var nameInput = $("name");
  var statusEl = $("status");
  var submitBtn = $("submit-btn");

  // success overlay
  var overlay      = $("celebrate");
  var overlayTitle = $("celebrate-title");
  var overlayMsg   = $("celebrate-msg");
  var overlayBurst = $("celebrate-burst");
  var orderAgainBtn = $("order-again");

  function reducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // value stored in the <select> / sent to Formspree, e.g. "Spicy Margarita (Boozy)"
  function optionValue(item, section) { return item.name + " (" + section.label + ")"; }

  // ---- Render menus + dropdown -----------------------------------------
  SECTIONS.forEach(function (section) {
    var menuEl = $("menu-" + section.key);
    var optgroup = document.createElement("optgroup");
    optgroup.label = section.label;

    section.items.forEach(function (item) {
      var value = optionValue(item, section);

      // Card
      var card = document.createElement("article");
      card.className = "cocktail";

      var chips = item.ingredients
        .map(function (i) { return "<li>" + i + "</li>"; })
        .join("");

      card.innerHTML =
        '<h3><span class="emoji">' + item.emoji + "</span>" + item.name + "</h3>" +
        '<ul class="ingredients">' + chips + "</ul>" +
        '<button type="button" class="order">Order this →</button>';

      card.querySelector(".order").addEventListener("click", function () {
        chooseDrink(value);
      });
      menuEl.appendChild(card);

      // Dropdown option
      var opt = document.createElement("option");
      opt.value = value;
      opt.textContent = item.emoji + " " + item.name;
      optgroup.appendChild(opt);
    });

    select.appendChild(optgroup);
  });

  // ---- Order flow: pick a drink, jump to form, assist the keyboard -----
  function chooseDrink(value) {
    select.value = value;

    // Scroll the form into view (respects reduced-motion via CSS).
    formCard.scrollIntoView({ behavior: "smooth", block: "start" });

    // If we don't know the name yet, focus it to pop the mobile keyboard.
    // focus() here is inside the tap gesture, so iOS/Android allow it.
    if (!nameInput.value.trim()) {
      nameInput.focus({ preventScroll: true });
    }

    // Brief flash so it's obvious which drink got selected.
    select.classList.remove("flash");
    void select.offsetWidth; // restart the animation
    select.classList.add("flash");
  }

  // ---- Tabs (accessible: click + arrow keys) ---------------------------
  var tabs = [
    { btn: $("tab-booze"), panel: $("panel-booze") },
    { btn: $("tab-free"),  panel: $("panel-free") },
  ];
  function selectTab(index, focusBtn) {
    tabs.forEach(function (t, i) {
      var on = i === index;
      t.btn.setAttribute("aria-selected", on ? "true" : "false");
      t.btn.tabIndex = on ? 0 : -1;
      t.panel.classList.toggle("active", on);
      t.panel.hidden = !on;
    });
    if (focusBtn) { tabs[index].btn.focus(); }
  }
  tabs.forEach(function (t, i) {
    t.btn.addEventListener("click", function () { selectTab(i, false); });
    t.btn.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        selectTab((i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length, true);
      }
    });
  });

  // ---- Remember the name across visits ---------------------------------
  try {
    var saved = localStorage.getItem(NAME_KEY);
    if (saved) { nameInput.value = saved; }
  } catch (e) { /* private mode / blocked storage — ignore */ }

  function rememberName() {
    try { localStorage.setItem(NAME_KEY, nameInput.value.trim()); } catch (e) { /* ignore */ }
  }
  nameInput.addEventListener("change", rememberName);

  // ---- Submit via AJAX (stay on page, show a thank-you) ----------------
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    rememberName();
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
        var sel = select.options[select.selectedIndex];
        var orderedDrink = sel ? sel.textContent.trim() : "";
        form.reset();
        nameInput.value = orderedName; // keep their name for the next round
        statusEl.className = "status";
        statusEl.textContent = "";
        celebrate(orderedName, orderedDrink);
      })
      .catch(function () {
        statusEl.className = "status err";
        statusEl.textContent = "OOPS — try that again!";
      })
      .finally(function () {
        submitBtn.disabled = false;
      });
  });

  // ---- Success celebration --------------------------------------------
  function celebrate(name, drink) {
    overlayTitle.textContent = name ? "Cheers, " + name + "! 🥂" : "Cheers! 🥂";
    overlayMsg.innerHTML =
      "Your " + (drink ? "<strong>" + escapeHtml(drink) + "</strong>" : "drink") +
      " is on the way. 🍹";
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
    tabs[0].btn.focus(); // back at the top, ready to order another
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

  // ---- Background confetti cannon: emojis blast in from the edges -----
  (function buildConfetti() {
    if (reducedMotion()) { return; } // skip the whole effect for motion-sensitive users

    var ICONS = [
      "🍸", "🍹", "🍋‍🟩", "🍉", "🌶️", "🌿", "🧊", "🍊", "🫚", "🌸",
      "🥂", "🍃", "🧉", "🥃", "🫧", "🍆", "🍌", "🍑",
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
