const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const hero = document.querySelector(".hero");
const stage = document.querySelector(".studio-stage");
let pointerFrame;
hero.addEventListener("pointermove", (event) => {
  if (
    reducedMotion.matches ||
    event.pointerType !== "mouse" ||
    innerWidth < 1000
  )
    return;
  cancelAnimationFrame(pointerFrame);
  pointerFrame = requestAnimationFrame(() => {
    const bounds = hero.getBoundingClientRect();
    stage.style.setProperty(
      "--px",
      `${((event.clientX - bounds.left) / bounds.width - 0.5) * 16}px`,
    );
    stage.style.setProperty(
      "--py",
      `${((event.clientY - bounds.top) / bounds.height - 0.5) * 12}px`,
    );
  });
});
hero.addEventListener("pointerleave", () => {
  cancelAnimationFrame(pointerFrame);
  stage.style.setProperty("--px", "0px");
  stage.style.setProperty("--py", "0px");
});
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.06 },
);
document
  .querySelectorAll("#form,.project-heading,.team-directory,.settings")
  .forEach((element) => {
    element.classList.add("reveal");
    observer.observe(element);
  });
const typeSelect = document.querySelector("#type");
document.querySelectorAll("[data-project-type]").forEach((button) =>
  button.addEventListener("click", () => {
    typeSelect.value = button.dataset.projectType;
    typeSelect.dispatchEvent(new Event("change"));
    document.querySelector("#form").scrollIntoView({
      behavior: reducedMotion.matches ? "instant" : "smooth",
    });
  }),
);
function updateTypeButtons() {
  document.querySelectorAll("[data-project-type]").forEach((button) => {
    const active = button.dataset.projectType === typeSelect.value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}
typeSelect.addEventListener("change", updateTypeButtons);
updateTypeButtons();

// One quiet meteor at a time, with a fresh interval and path each time.
const shootingStar = document.querySelector(".night-shooting-star");
let meteorTimer;
let meteorAnimation;
const randomBetween = (min, max) => min + Math.random() * (max - min);
function stopMeteor() {
  clearTimeout(meteorTimer);
  if (meteorAnimation) {
    meteorAnimation.onfinish = null;
    meteorAnimation.cancel();
    meteorAnimation = null;
  }
}
function scheduleMeteor() {
  stopMeteor();
  if (!shootingStar || document.hidden || reducedMotion.matches) return;
  meteorTimer = setTimeout(playMeteor, randomBetween(35000, 70000));
}
function playMeteor() {
  if (document.hidden || reducedMotion.matches) return;
  const towardRight = Math.random() > 0.5;
  const angle = randomBetween(20, 36);
  const distance = randomBetween(0.65, 1) * Math.min(260, innerWidth * 0.3);
  const dx =
    Math.cos((angle * Math.PI) / 180) * distance * (towardRight ? 1 : -1);
  const dy = Math.sin((angle * Math.PI) / 180) * distance;
  const rotation = towardRight ? 180 + angle : -angle;
  const brightness = randomBetween(0.28, 0.45);
  shootingStar.style.left = `${towardRight ? randomBetween(18, 48) : randomBetween(52, 82)}%`;
  shootingStar.style.top = `${randomBetween(14, 38)}%`;
  shootingStar.style.width = `${randomBetween(55, Math.min(110, innerWidth * 0.2))}px`;
  const transformAt = (portion) =>
    `translate3d(${dx * portion}px, ${dy * portion}px, 0) rotate(${rotation}deg)`;
  meteorAnimation = shootingStar.animate(
    [
      { opacity: 0, transform: transformAt(0), offset: 0 },
      { opacity: brightness, transform: transformAt(0.2), offset: 0.2 },
      { opacity: 0, transform: transformAt(1), offset: 1 },
    ],
    { duration: randomBetween(1300, 1900), easing: "linear" },
  );
  meteorAnimation.onfinish = scheduleMeteor;
}
document.addEventListener("visibilitychange", scheduleMeteor);
reducedMotion.addEventListener("change", scheduleMeteor);
window.addEventListener("pagehide", stopMeteor);
window.addEventListener("pageshow", scheduleMeteor);
scheduleMeteor();

// Rotate the home cards using the same identities and settings as the AI directory.
const floatingCards = [...document.querySelectorAll(".agent-tag")];
const aiRoles = {
  codex: "PLAN & DIRECT",
  claude: "BUILD & DEVELOP",
  gemini: "REVIEW & REFINE",
  cursor: "CODE & REFACTOR",
  v0: "UI & PROTOTYPE",
  midjourney: "ART & CONCEPT",
  notion: "DOCS & ORGANIZE",
  perplexity: "SEARCH & RESEARCH",
  copilot: "CODE & ASSIST",
  stability: "IMAGE & DESIGN",
  meshy: "3D & ASSETS",
  tripo: "3D & CREATE",
};
const rotatingAIs = [...document.querySelectorAll("#ai-team .ai-card")].map(
  (card) => ({
    id: card.querySelector(".connection").id,
    name: card.querySelector("strong").textContent,
    logo: card.querySelector(".ai-brand-logo").getAttribute("src"),
  }),
);
const initialIds = ["codex", "claude", "gemini"];
rotatingAIs.sort((a, b) => {
  const rank = (id) =>
    initialIds.includes(id)
      ? initialIds.indexOf(id)
      : initialIds.length + Object.keys(aiRoles).indexOf(id);
  return rank(a.id) - rank(b.id);
});

let rotationIndex = 0;
let rotationTimer;
let rotationRevision = 0;
const rotationAnimations = new Set();
function stopAIRotation() {
  clearTimeout(rotationTimer);
  rotationRevision++;
  rotationAnimations.forEach((animation) => animation.cancel());
  rotationAnimations.clear();
}
async function fadeAIContents(from, to, duration) {
  const animations = floatingCards.flatMap((card) =>
    [...card.children].map((content) => {
      const animation = content.animate([{ opacity: from }, { opacity: to }], {
        duration,
        easing: "ease-in-out",
        fill: "forwards",
      });
      rotationAnimations.add(animation);
      return animation;
    }),
  );
  await Promise.allSettled(animations.map((animation) => animation.finished));
}
function scheduleAIRotation(delay = 8000) {
  stopAIRotation();
  if (location.pathname !== "/" || document.hidden) return;
  const revision = rotationRevision;
  rotationTimer = setTimeout(async () => {
    const started = Date.now();
    if (!floatingCards.some((card) => card.matches(":hover, :focus-within"))) {
      if (!reducedMotion.matches) await fadeAIContents(1, 0, 320);
      if (revision !== rotationRevision) return;
      // Keep the old destination if focus arrives during fade-out.
      if (floatingCards.some((card) => card.matches(":hover, :focus-within"))) {
        if (!reducedMotion.matches) await fadeAIContents(0, 1, 240);
        if (revision === rotationRevision) scheduleAIRotation();
        return;
      }
      rotationIndex =
        (rotationIndex + floatingCards.length) % rotatingAIs.length;
      floatingCards.forEach((card, index) => {
        const ai = rotatingAIs[(rotationIndex + index) % rotatingAIs.length];
        card.href = "/team#connect-" + ai.id;
        card.setAttribute("aria-label", ai.name + " 연결 설정");
        card.querySelector("img").src = ai.logo;
        card.querySelector("b").textContent = ai.name;
        card.querySelector("small").textContent =
          aiRoles[ai.id] || "AI WORKSPACE";
      });
      if (!reducedMotion.matches) await fadeAIContents(0, 1, 480);
    }
    if (revision === rotationRevision)
      scheduleAIRotation(Math.max(0, 8000 - (Date.now() - started)));
  }, delay);
}
document.addEventListener("visibilitychange", () => scheduleAIRotation());
window.addEventListener("pagehide", stopAIRotation);
window.addEventListener("pageshow", () => scheduleAIRotation());
reducedMotion.addEventListener("change", () => scheduleAIRotation());
scheduleAIRotation();

window.addEventListener("office-route-change", () => scheduleAIRotation());
