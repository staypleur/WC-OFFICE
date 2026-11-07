let marketingProject = null,
  marketingTimer,
  marketingController;
let marketingView = "";
const marketingDrafts = new Map();
const marketingNode = (id) => document.getElementById(id);
async function pollMarketing() {
  clearTimeout(marketingTimer);
  marketingController?.abort();
  if (
    location.pathname !== "/marketing" ||
    !marketingProject ||
    document.hidden
  )
    return;
  const id = marketingProject;
  const controller = new AbortController();
  marketingController = controller;
  try {
    const response = await fetch("/api/marketing/" + encodeURIComponent(id), {
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "대화를 불러오지 못했습니다.");
    if (id !== marketingProject || controller.signal.aborted) return;
    const view = JSON.stringify(data.messages);
    if (view !== marketingView) {
      const feed = marketingNode("marketing-messages");
      const nearBottom =
        feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
      feed.replaceChildren();
      if (!data.messages.length) {
        const empty = document.createElement("p");
        empty.className = "notice";
        empty.textContent = "이 프로젝트의 첫 마케팅 대화를 시작하세요.";
        feed.append(empty);
      }
      for (const message of data.messages) {
        const item = document.createElement("article");
        const label = document.createElement("strong");
        label.textContent = message.role;
        const text = document.createElement("p");
        text.textContent = message.text;
        item.append(label, text);
        feed.append(item);
      }
      if (nearBottom || !marketingView) feed.scrollTop = feed.scrollHeight;
      marketingView = view;
    }
    marketingNode("marketing-status").textContent = data.busy
      ? "답변 작성 중…"
      : "마케팅 전용 대화";
    marketingNode("marketing-form").querySelector("button").disabled =
      data.busy;
  } catch (error) {
    if (error.name !== "AbortError")
      marketingNode("marketing-status").textContent = "연결 재시도 중";
  } finally {
    if (
      !controller.signal.aborted &&
      location.pathname === "/marketing" &&
      id === marketingProject &&
      !document.hidden
    )
      marketingTimer = setTimeout(pollMarketing, 3000);
  }
}
marketingNode("marketing-projects").addEventListener("click", (event) => {
  const button = event.target.closest("[data-marketing]");
  if (!button) return;
  if (marketingProject)
    marketingDrafts.set(
      marketingProject,
      marketingNode("marketing-input").value,
    );
  marketingProject = button.dataset.marketing;
  marketingView = "";
  marketingNode("marketing-title").textContent =
    button.querySelector("strong").textContent;
  marketingNode("marketing-room").hidden = false;
  marketingNode("marketing-error").textContent = "";
  marketingNode("marketing-messages").textContent = "대화를 불러오는 중…";
  marketingNode("marketing-input").value =
    marketingDrafts.get(marketingProject) || "";
  marketingNode("marketing-form").querySelector("button").disabled = true;
  void pollMarketing();
  marketingNode("marketing-input").focus({ preventScroll: true });
  marketingNode("marketing-room").scrollIntoView({
    block: "nearest",
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
  });
});
marketingNode("marketing-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = marketingProject;
  if (!id) return;
  const text = marketingNode("marketing-input").value;
  marketingNode("marketing-form").querySelector("button").disabled = true;
  marketingNode("marketing-error").textContent = "";
  try {
    const response = await fetch("/api/marketing/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, message: text }),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    marketingDrafts.delete(id);
    if (marketingProject === id) marketingNode("marketing-input").value = "";
    void pollMarketing();
  } catch (error) {
    if (marketingProject === id) {
      marketingNode("marketing-error").textContent = error.message;
      marketingNode("marketing-form").querySelector("button").disabled = false;
    }
  }
});
window.addEventListener("office-route-change", pollMarketing);
document.addEventListener("visibilitychange", pollMarketing);
window.addEventListener("pagehide", () => {
  clearTimeout(marketingTimer);
  marketingController?.abort();
});
window.addEventListener("pageshow", pollMarketing);
