// The web app's top bar is pinned, and the bars pinned under it need its height, which changes as the bar wraps.

/** Keeps --header-height on the page at the height of `header`. The handle's `dispose` stops it. */
export function observe(header) {
  const root = document.documentElement;
  const update = () => root.style.setProperty("--header-height", `${header.offsetHeight}px`);
  const resized = new ResizeObserver(update);
  resized.observe(header);
  update();
  return {
    dispose() {
      resized.disconnect();
      root.style.removeProperty("--header-height");
    },
  };
}
