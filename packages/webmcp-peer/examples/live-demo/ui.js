// DOM helpers shared by the demo. Every dynamic value goes through textContent, never innerHTML,
// because tool names/descriptions come from user input and remote peers.

export const $ = (id) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing demo element #${id}`);
  return node;
};

/** Creates an element: el("span", { class: "badge ok" }, "text", childNode). */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

export function setBadge(id, tone, text) {
  const node = $(id);
  node.className = tone ? `badge ${tone}` : "badge";
  node.textContent = text;
  node.title = text;
}

export function setText(id, text) {
  const node = $(id);
  const next = String(text);
  if (node.textContent !== next) {
    node.textContent = next;
    node.classList.remove("changed");
    void node.offsetWidth;
    node.classList.add("changed");
  }
}

export function flash(node, className = "flash", ms = 450) {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
  setTimeout(() => node.classList.remove(className), ms);
}

export function shortHash(hash, size = 10) {
  return hash ? `${String(hash).slice(0, size)}…` : "-";
}

// ---------- Wire log ----------
const MAX_WIRE_ENTRIES = 200;
let frameCount = 0;

/**
 * Appends one protocol frame to the Tier 2 stream.
 * @param {string} route e.g. "Tier 1 → Tier 2"
 * @param {string} title human summary of the frame
 * @param {unknown} payload raw frame / body (secrets must be stripped by the caller)
 * @param {"ok"|"info"|"warn"|"err"|"purple"} tone
 */
export function logWire(route, title, payload, tone = "info") {
  frameCount += 1;
  $("frame-count").textContent = `${frameCount} frames`;
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  const entry = el(
    "div",
    { class: "wire-entry" },
    el(
      "div",
      { class: "wire-entry-head" },
      el("span", { class: `badge ${tone}` }, route),
      el("strong", {}, title),
      el("time", {}, new Date().toLocaleTimeString("ko-KR", { hour12: false })),
    ),
    text && text !== "{}"
      ? el("details", {}, el("summary", {}, "payload"), el("pre", { class: "wire-payload" }, text))
      : null,
  );
  const log = $("wire-log");
  log.prepend(entry);
  while (log.childElementCount > MAX_WIRE_ENTRIES) log.lastElementChild.remove();
}

export function clearWireLog() {
  frameCount = 0;
  $("wire-log").replaceChildren();
  $("frame-count").textContent = "0 frames";
}
