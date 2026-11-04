// The web app's top bar is pinned, and the bars pinned under it need its height, which changes as the bar wraps. On a
// phone the bar slides away as the page scrolls down and comes back as it scrolls up, and the bars under it move up with
// it. It moves by its own top, not a transform: a transform would hold the fixed bottom bar and sidebar inside it.

const phone = window.matchMedia("(max-width: 600px)");

/** Keeps --header-height on the page at the height of `header` in view. The handle's `dispose` stops it. */
export function observe(header) {
  const root = document.documentElement;
  let tucked = false;
  let lastY = window.scrollY;

  const update = () => {
    header.style.top = tucked ? `-${header.offsetHeight}px` : "";
    root.style.setProperty("--header-height", tucked ? "0px" : `${header.offsetHeight}px`);
  };

  const scrolled = () => {
    const y = window.scrollY;
    const tuck = phone.matches && y > header.offsetHeight && (y > lastY + 4 || (tucked && y >= lastY - 4));
    if (Math.abs(y - lastY) > 4 || y <= header.offsetHeight) lastY = y;
    if (tuck !== tucked) {
      tucked = tuck;
      update();
    }
  };

  const resized = new ResizeObserver(update);
  resized.observe(header);
  window.addEventListener("scroll", scrolled, { passive: true });
  phone.addEventListener("change", scrolled);
  update();
  return {
    dispose() {
      resized.disconnect();
      window.removeEventListener("scroll", scrolled);
      phone.removeEventListener("change", scrolled);
      header.style.top = "";
      root.style.removeProperty("--header-height");
    },
  };
}
