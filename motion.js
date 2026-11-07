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
