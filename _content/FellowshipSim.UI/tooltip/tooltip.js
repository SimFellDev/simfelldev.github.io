// The app's tooltip: one bubble (TooltipLayer) beside the element under the pointer, tapped, or with keyboard focus. Its
// text is the element's data-tooltip, or a copy of the markup a Tooltip component holds. The bubble is fixed to the window,
// so no scrolling list or table clips it, and it goes on the side data-tooltip-direction names (down without one) unless
// the window has no room there.

const padding = 10;
const gap = 8;
const anchors = '[data-tooltip]:not([data-tooltip=""]), .tooltip-anchor';
const directions = {
  up: ["up", "down", "right", "left"],
  down: ["down", "up", "right", "left"],
  left: ["left", "right", "up", "down"],
  right: ["right", "left", "up", "down"],
};

let bubble = null;
let anchor = null;
let focused = false;
let pointerX = null;
let describedBy = null;
let watch = 0;

/** Shows every tooltip in `element`. The handle's `dispose` removes the listeners. */
export function start(element) {
  bubble = element;
  const options = { capture: true, passive: true };
  document.addEventListener("pointerover", onPointerOver, options);
  document.addEventListener("pointerout", onPointerOut, options);
  document.addEventListener("pointerdown", onPointerDown, options);
  document.addEventListener("focusin", onFocusIn, options);
  document.addEventListener("focusout", onFocusOut, options);
  document.addEventListener("keydown", onKeyDown, options);
  document.addEventListener("scroll", hide, options);
  window.addEventListener("resize", hide, options);
  return {
    dispose() {
      hide();
      document.removeEventListener("pointerover", onPointerOver, options);
      document.removeEventListener("pointerout", onPointerOut, options);
      document.removeEventListener("pointerdown", onPointerDown, options);
      document.removeEventListener("focusin", onFocusIn, options);
      document.removeEventListener("focusout", onFocusOut, options);
      document.removeEventListener("keydown", onKeyDown, options);
      document.removeEventListener("scroll", hide, options);
      window.removeEventListener("resize", hide, options);
      if (bubble === element) bubble = null;
    },
  };
}

const anchorOf = (target) => (target instanceof Element ? target.closest(anchors) : null);

function onPointerOver(event) {
  if (event.pointerType === "touch") return;
  const next = anchorOf(event.target);
  if (next !== anchor) next ? show(next, event.clientX) : hide();
}

function onPointerOut(event) {
  // The pointer left the window.
  if (event.pointerType !== "touch" && event.relatedTarget === null && !focused) hide();
}

// A click hides the tooltip, as the browser's does. A tap shows the tapped element's tooltip, and a tap elsewhere hides it.
function onPointerDown(event) {
  const next = event.pointerType === "touch" ? anchorOf(event.target) : null;
  if (next && next !== anchor) show(next, event.clientX);
  else hide();
}

function onFocusIn(event) {
  if (!(event.target instanceof Element) || !event.target.matches(":focus-visible")) return;
  const next = anchorOf(event.target);
  if (next) show(next, null);
}

function onFocusOut() {
  if (focused) hide();
}

function onKeyDown(event) {
  if (event.key === "Escape") hide();
}

// `x` is the pointer's, or null when keyboard focus shows the tooltip.
function show(next, x) {
  if (!bubble) return;
  hide();
  anchor = next;
  focused = x === null;
  pointerX = x;
  fill();
  describedBy = anchor.getAttribute("aria-describedby");
  if (describedBy === null) anchor.setAttribute("aria-describedby", bubble.id);
  bubble.hidden = false;
  place();
  // A render can take the element away or change its text while the tooltip shows.
  watch = setInterval(() => {
    if (!anchor.isConnected || (!anchor.classList.contains("tooltip-anchor") && !anchor.dataset.tooltip)) hide();
    else if (fill()) place();
  }, 250);
}

function hide() {
  clearInterval(watch);
  if (anchor && describedBy === null) anchor.removeAttribute("aria-describedby");
  anchor = null;
  focused = false;
  if (!bubble) return;
  bubble.hidden = true;
  delete bubble.dataset.html;
  bubble.classList.remove("rich");
  bubble.replaceChildren();
}

/** Puts the anchor's content in the bubble; true when it changed. */
function fill() {
  const content = anchor.querySelector(":scope > .tooltip-content");
  if (content) {
    if (bubble.dataset.html === content.innerHTML) return false;
    bubble.dataset.html = content.innerHTML;
    bubble.classList.add("rich");
    bubble.replaceChildren(...[...content.childNodes].map((node) => node.cloneNode(true)));
    return true;
  }
  const text = anchor.dataset.tooltip;
  if (!bubble.classList.contains("rich") && bubble.textContent === text) return false;
  delete bubble.dataset.html;
  bubble.classList.remove("rich");
  bubble.textContent = text;
  return true;
}

// A Tooltip component's anchor has no box of its own (display: contents): its rectangle is that of what it shows.
function rectOf(element) {
  if (!element.classList.contains("tooltip-anchor") || !element.firstChild) return element.getBoundingClientRect();
  const range = document.createRange();
  range.setStartBefore(element.firstChild);
  range.setEndBefore(element.querySelector(":scope > .tooltip-content") ?? element.lastChild);
  return range.getBoundingClientRect();
}

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

function place() {
  const rect = rectOf(anchor);
  const width = bubble.offsetWidth;
  const height = bubble.offsetHeight;
  const windowWidth = document.documentElement.clientWidth;
  const windowHeight = document.documentElement.clientHeight;
  const room = {
    up: rect.top - gap - padding >= height,
    down: windowHeight - rect.bottom - gap - padding >= height,
    left: rect.left - gap - padding >= width,
    right: windowWidth - rect.right - gap - padding >= width,
  };
  const preferred = directions[anchor.dataset.tooltipDirection] ? anchor.dataset.tooltipDirection : "down";
  const side = directions[preferred].find((s) => room[s]) ?? preferred;
  let left;
  let top;
  let arrow;
  if (side === "up" || side === "down") {
    // Above or below an element wider than the bubble, the bubble is at the pointer, as the browser's tooltip is.
    const centre = pointerX !== null && rect.width > width ? clamp(pointerX, rect.left, rect.right) : rect.left + rect.width / 2;
    left = clamp(centre - width / 2, padding, windowWidth - padding - width);
    top = side === "up" ? rect.top - gap - height : rect.bottom + gap;
    arrow = clamp(centre - left, 12, width - 12);
  } else {
    top = clamp(rect.top + rect.height / 2 - height / 2, padding, windowHeight - padding - height);
    left = side === "left" ? rect.left - gap - width : rect.right + gap;
    arrow = clamp(rect.top + rect.height / 2 - top, 12, height - 12);
  }
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(top)}px`;
  bubble.style.setProperty("--arrow", `${Math.round(arrow)}px`);
  bubble.dataset.side = side;
}
