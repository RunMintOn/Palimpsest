const languageLinks = document.querySelectorAll("[data-language]");
for (const link of languageLinks) {
  link.addEventListener("click", () => {
    try {
      window.localStorage.setItem("palimpsest-language", link.dataset.language);
    } catch {
      // The link still changes language when storage is unavailable.
    }
  });
}

const hero = document.querySelector(".hero");
const motionAllowed = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (hero && motionAllowed) {
  requestAnimationFrame(() => {
    hero.classList.add("is-entering");
    window.setTimeout(() => hero.classList.remove("is-entering"), 1800);
  });

  document.documentElement.classList.add("motion-ready");
  const revealTargets = document.querySelectorAll(".time-field, .mechanism-flow, .obsidian-window, .local-section dl");
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.dataset.visible = "true";
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.22 });
  revealTargets.forEach((target) => observer.observe(target));
}
