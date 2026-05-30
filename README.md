# 🍸 The Little Cocktail Bar

A tiny single-page cocktail menu where guests can build a round of drinks and
request them with their name. Hosted free on **GitHub Pages**, deployed via
**GitHub Actions**, and requests are delivered to your inbox via **Formspree**.

## One-time setup

### 1. Get a Formspree endpoint (so requests reach your email)
1. Sign up free at <https://formspree.io>.
2. Create a new form; it gives you an endpoint like `https://formspree.io/f/abcdwxyz`.
3. In `index.html`, replace `YOUR_FORM_ID` in the form `action` with your real ID.
4. The first time someone submits, Formspree emails you to confirm the address.

### 2. Enable GitHub Pages
In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
Every push to `main` then publishes automatically.

## Edit the menu
The cocktail list lives in one place — the `SECTIONS` array at the top of
`app.js`. It drives the tabbed sections, the menu cards, and the order basket,
so they never drift apart. Add a section or a drink there and everything updates.

## Local preview
Just open `index.html` in a browser, or run `python -m http.server` in this folder.
