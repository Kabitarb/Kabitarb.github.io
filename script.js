/* ------------------------------------------------------------------
   Project data - add a new object here to add a project to the site.
   category: "ml" | "data"
------------------------------------------------------------------ */
const projects = [
  {
    id: "diabetes",
    title: "Diabetes Prediction",
    category: "ml",
    categoryLabel: "Machine Learning",
    image: "photos/diabetes.png",
    summary: "Classification model that predicts diabetes risk from health indicators.",
    description:
      "Explored multiple classification algorithms using Lazy Predict to quickly compare their performance " +
      "metrics on the Diabetes Health Indicators dataset. Selected the best performing model based on accuracy " +
      "and further fine-tuned its hyper-parameters to improve prediction quality.",
    meta: {
      Dataset: "Diabetes Health Indicators Dataset (Kaggle)",
      Type: "Binary classification",
      Result: "86% accuracy"
    },
    highlights: [
      "Cleaned and encoded the health indicator features",
      "Benchmarked many classifiers in one pass with Lazy Predict",
      "Fine-tuned the best performing model to improve accuracy"
    ],
    tools: ["Python", "Scikit-learn", "Lazy Predict", "Pandas"],
    links: [{ label: "View on GitHub", url: "https://github.com/Kabitarb/Diabetes-Prediction" }]
  },
  {
    id: "honey",
    title: "Honey Production Prediction",
    category: "ml",
    categoryLabel: "Machine Learning",
    image: "photos/honey.png",
    summary: "Regression model that forecasts US honey production trends.",
    description:
      "Developed a regression model to analyse historical honey production data and forecast future trends. " +
      "The trained model was serialised with Joblib and exposed through a small Flask API so predictions can be " +
      "requested from any client.",
    meta: {
      Dataset: "Honey Production Dataset (Kaggle)",
      Type: "Regression / forecasting",
      Result: "92% accuracy (R\u00B2)"
    },
    highlights: [
      "Exploratory analysis and visualisation of historical production data",
      "Trained and evaluated a regression model to forecast future trends",
      "Saved the model with Joblib and served it through a Flask endpoint"
    ],
    tools: ["Python", "Pandas", "NumPy", "Matplotlib", "Scikit-learn", "Flask", "Joblib"],
    links: [{ label: "View on GitHub", url: "https://github.com/Kabitarb/Honey-Prediction" }]
  }
];

/* ------------------------------------------------------------------
   Render project cards
------------------------------------------------------------------ */
const grid = document.getElementById("projectsGrid");
const emptyState = document.getElementById("projectsEmpty");

const placeholderIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zm2 2v9.6l3.5-3.5 3 3 2.5-2.5L18 15.6V6zm0 12.4V18h12v-.4l-3-3-2.5 2.5-3-3z"/></svg>';

function renderProjects() {
  grid.innerHTML = projects
    .map((p) => {
      const media = p.image
        ? `<img src="${p.image}" alt="${p.title}" loading="lazy">`
        : `<div class="project-card__placeholder">${placeholderIcon}</div>`;
      return `
        <button class="project-card reveal" data-id="${p.id}" data-category="${p.category}" aria-haspopup="dialog">
          ${media}
          <span class="project-card__label">${p.categoryLabel}</span>
          <div class="project-card__overlay">
            <span class="project-card__tag">${p.categoryLabel}</span>
            <span class="project-card__title">${p.title}</span>
            <p class="project-card__summary">${p.summary}</p>
            <span class="project-card__more">View details &rarr;</span>
          </div>
        </button>`;
    })
    .join("");
}

renderProjects();

/* ------------------------------------------------------------------
   Filters
------------------------------------------------------------------ */
document.querySelectorAll(".filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-selected", "false");
    });
    btn.classList.add("is-active");
    btn.setAttribute("aria-selected", "true");

    const filter = btn.dataset.filter;
    let visible = 0;
    document.querySelectorAll(".project-card").forEach((card) => {
      const show = filter === "all" || card.dataset.category === filter;
      card.classList.toggle("is-hidden", !show);
      if (show) visible++;
    });
    emptyState.hidden = visible > 0;
  });
});

/* ------------------------------------------------------------------
   Modal
------------------------------------------------------------------ */
const modal = document.getElementById("projectModal");
const modalImage = document.getElementById("modalImage");
const modalTag = document.getElementById("modalTag");
const modalTitle = document.getElementById("modalTitle");
const modalDescription = document.getElementById("modalDescription");
const modalMeta = document.getElementById("modalMeta");
const modalHighlights = document.getElementById("modalHighlights");
const modalTools = document.getElementById("modalTools");
const modalActions = document.getElementById("modalActions");
let lastFocused = null;

function openModal(id) {
  const p = projects.find((x) => x.id === id);
  if (!p) return;

  modalImage.src = p.image || "";
  modalImage.alt = p.title;
  modalImage.parentElement.style.display = p.image ? "" : "none";
  modalTag.textContent = p.categoryLabel;
  modalTitle.textContent = p.title;
  modalDescription.textContent = p.description;

  modalMeta.innerHTML = Object.entries(p.meta || {})
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join("");

  modalHighlights.innerHTML = (p.highlights || []).map((h) => `<li>${h}</li>`).join("");
  modalTools.innerHTML = (p.tools || []).map((t) => `<span>${t}</span>`).join("");
  modalActions.innerHTML = (p.links || [])
    .map((l) => `<a class="btn btn--outline" href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`)
    .join("");

  lastFocused = document.activeElement;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  modal.querySelector(".modal__close").focus();
}

function closeModal() {
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  if (lastFocused) lastFocused.focus();
}

grid.addEventListener("click", (e) => {
  const card = e.target.closest(".project-card");
  if (card) openModal(card.dataset.id);
});

modal.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeModal));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeModal();
});

/* ------------------------------------------------------------------
   Header state, mobile nav and active link highlighting
------------------------------------------------------------------ */
const header = document.querySelector(".site-header");
const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector(".nav-links");

function onScroll() {
  header.classList.toggle("is-scrolled", window.scrollY > 40);
}
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

navToggle.addEventListener("click", () => {
  const open = navLinks.classList.toggle("is-open");
  navToggle.classList.toggle("is-open", open);
  navToggle.setAttribute("aria-expanded", String(open));
});

navLinks.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => {
    navLinks.classList.remove("is-open");
    navToggle.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  })
);

const sectionLinks = [...navLinks.querySelectorAll('a[href^="#"]:not(.btn)')];
const sections = sectionLinks
  .map((a) => document.querySelector(a.getAttribute("href")))
  .filter(Boolean);

const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      sectionLinks.forEach((a) =>
        a.classList.toggle("is-active", a.getAttribute("href") === `#${entry.target.id}`)
      );
    });
  },
  { rootMargin: "-40% 0px -55% 0px" }
);
sections.forEach((s) => sectionObserver.observe(s));

/* ------------------------------------------------------------------
   Scroll reveal
------------------------------------------------------------------ */
const revealObserver = new IntersectionObserver(
  (entries, obs) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        obs.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);

function observeReveals() {
  document.querySelectorAll(".reveal:not(.is-visible)").forEach((el) => revealObserver.observe(el));
}
observeReveals();

/* ------------------------------------------------------------------
   Contact form -> opens the visitor's email client with the message
------------------------------------------------------------------ */
const form = document.getElementById("contactForm");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  let valid = true;

  form.querySelectorAll(".field").forEach((field) => {
    const input = field.querySelector("input, textarea");
    const ok = input.checkValidity() && input.value.trim() !== "";
    field.classList.toggle("is-invalid", !ok);
    if (!ok) valid = false;
  });

  if (!valid) return;

  const data = new FormData(form);
  const subject = encodeURIComponent(`Portfolio enquiry from ${data.get("name")}`);
  const body = encodeURIComponent(`${data.get("message")}\n\nFrom: ${data.get("name")} <${data.get("email")}>`);
  window.location.href = `mailto:kabitarb99@gmail.com?subject=${subject}&body=${body}`;

  form.reset();
});

form.querySelectorAll("input, textarea").forEach((input) =>
  input.addEventListener("input", () => input.closest(".field").classList.remove("is-invalid"))
);

/* ------------------------------------------------------------------
   Footer year
------------------------------------------------------------------ */
document.getElementById("year").textContent = new Date().getFullYear();
