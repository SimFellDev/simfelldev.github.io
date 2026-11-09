// Shows a review page in the app page itself: its markup in a shadow root, styled by review.css with the app's colours
// in place of the page's own stylesheet. A step link scrolls to its step; a link to another review page opens it in the
// app. The page's file is fetched from the review address when the app shares its origin (the web app), else read
// through .NET (the desktop app's review host is another origin).
let sheet = null;

async function styles() {
  if (sheet) return sheet;
  const css = await (await fetch('_content/FellowshipSim.UI/review/review.css')).text();
  sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return sheet;
}

async function read(url, dotnet) {
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (response.ok) return await response.text();
  } catch {
    // Another origin: read through .NET.
  }
  return await dotnet.invokeMethodAsync('Read');
}

// A script parsed by DOMParser never runs, so the page's own script goes in afresh, reading its markup from
// window.reviewRoot: its row toggles and engine states work here as they do in the saved file.
function runPageScript(page) {
  window.reviewRoot = page;
  for (const parsed of page.querySelectorAll('script:not([type])')) {
    const script = document.createElement('script');
    script.textContent = parsed.textContent;
    parsed.replaceWith(script);
  }
  delete window.reviewRoot;
}

export async function show(host, url, dotnet) {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  host.reviewDotnet = dotnet;
  if (!host.reviewLinks) {
    host.reviewLinks = true;
    root.addEventListener('click', e => {
      const link = e.target.closest?.('a[href]');
      if (!link) return;
      const href = link.getAttribute('href');
      if (href.startsWith('#')) {
        e.preventDefault();
        root.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' });
      } else if (/^[\w.-]+\.html$/.test(href)) {
        e.preventDefault();
        host.reviewDotnet.invokeMethodAsync('Open', href);
      }
    });
  }
  root.adoptedStyleSheets = [await styles()];
  root.innerHTML = '<p class="muted">Loading the review…</p>';
  const html = await read(url, dotnet);
  host.reviewHtml = html;
  const page = document.createElement('div');
  page.className = 'review';
  if (html) page.append(...new DOMParser().parseFromString(html, 'text/html').body.childNodes);
  else page.innerHTML = '<p class="muted">No review page.</p>';
  root.replaceChildren(page);
  runPageScript(page);
  return !!html;
}

// Saves the review page shown as its own HTML file, with its own stylesheet.
export function save(host, fileName) {
  if (!host.reviewHtml) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([host.reviewHtml], { type: 'text/html' }));
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

export function dispose(host) {
  host.reviewDotnet = null;
  host.reviewHtml = null;
}
