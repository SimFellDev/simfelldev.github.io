// Browser work of the condition builder's value picker that C# cannot do: focus, filtering as the search is typed, and the
// selection the arrow keys move. Blazor renders every option. This module sets only `hidden`, `aria-selected` and
// `aria-activedescendant` on them, and the list's left offset; it adds no node and moves none.

/** Opens the picker's list on `search`, with its `data-picked` option selected. The handle's `dispose` removes the listeners. */
export function open(button, popup, search, list, component) {
  const options = () => [...list.querySelectorAll('[role="option"]')];
  const visible = () => options().filter((o) => !o.hidden);
  const none = list.querySelector(".none");

  const select = (option) => {
    for (const o of list.querySelectorAll('[aria-selected="true"]')) o.removeAttribute("aria-selected");
    if (!option) {
      search.removeAttribute("aria-activedescendant");
      return;
    }
    option.setAttribute("aria-selected", "true");
    search.setAttribute("aria-activedescendant", option.id);
    option.scrollIntoView({ block: "nearest" });
  };

  const filter = () => {
    const query = search.value.trim().toLowerCase();
    // Each kind is one group: its heading and its options. A group with no option shown is hidden whole.
    for (const group of list.querySelectorAll(":scope > .kind")) {
      let shown = false;
      for (const option of group.querySelectorAll('[role="option"]')) {
        option.hidden = query.length > 0 && !option.dataset.search.includes(query);
        if (!option.hidden) shown = true;
      }
      group.hidden = !shown;
    }
    const shown = visible();
    if (none) none.hidden = shown.length > 0;
    select(shown[0]);
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const shown = visible();
      if (shown.length === 0) return;
      const at = shown.findIndex((o) => o.getAttribute("aria-selected") === "true");
      const next = event.key === "ArrowDown" ? Math.min(shown.length - 1, at + 1) : Math.max(0, at - 1);
      select(shown[next]);
    } else if (event.key === "Enter") {
      event.preventDefault();
      // Blazor's handlers listen at the document, so the event bubbles.
      list.querySelector('[aria-selected="true"]')?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    } else if (event.key === "Escape") {
      event.preventDefault();
      component.invokeMethodAsync("Close", true);
    }
  };

  const onOutside = (event) => {
    if (button.contains(event.target) || popup.contains(event.target)) return;
    // A click on another control keeps its focus; a click elsewhere focuses the button.
    const control = event.target instanceof Element && event.target.closest("input, select, textarea, button, a[href], [tabindex]");
    component.invokeMethodAsync("Close", !control);
  };

  // A list past the window's right edge moves left by the overlap.
  const overlap = popup.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
  if (overlap > 0) popup.style.left = `${-overlap}px`;

  search.addEventListener("input", filter);
  search.addEventListener("keydown", onKeyDown);
  document.addEventListener("mousedown", onOutside, true);
  search.focus({ preventScroll: true });
  select(list.querySelector("[data-picked]") ?? visible()[0]);

  return {
    dispose: () => {
      search.removeEventListener("input", filter);
      search.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onOutside, true);
    },
  };
}
