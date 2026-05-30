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
        { name: "Margarita",            emoji: "🍋", ingredients: ["Tequila", "Triple Sec / Cointreau", "Lime", "Simple Syrup (opt.)", "Crushed Ice", "Salt rim"] },
        { name: "Spicy Margarita",      emoji: "🌶️", ingredients: ["Tequila", "Triple Sec / Cointreau", "Lime", "Fresh Chili (jalapeño/red)", "Simple Syrup / Agave", "Crushed Ice", "Salt or Tajín rim"] },
        { name: "Watermelon Margarita", emoji: "🍉", ingredients: ["Watermelon", "Tequila", "Triple Sec / Cointreau", "Lime", "Simple Syrup (opt.)", "Crushed Ice", "Salt rim"] },
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
        var keepName = nameInput.value;
        form.reset();
        nameInput.value = keepName; // don't wipe the name they just gave us
        statusEl.className = "status ok";
        statusEl.textContent = "BOOM! Your drink's on the way 🍹";
      })
      .catch(function () {
        statusEl.className = "status err";
        statusEl.textContent = "OOPS — try that again!";
      })
      .finally(function () {
        submitBtn.disabled = false;
      });
  });
})();
