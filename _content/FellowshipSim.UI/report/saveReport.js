// Saves a report shown in the app (a sim's) as its own HTML file: the report's markup with the app's stylesheets.
// Elements marked data-save-skip (the save button) are left out.
// The rules of a sheet and of the sheets it imports (the scoped component styles); another origin's sheet, whose rules
// are unreadable (the fonts), is a link.
function rules(sheet, links) {
  let cssRules;
  try {
    cssRules = sheet.cssRules;
  } catch {
    if (sheet.href) links.push(`<link rel="stylesheet" href="${sheet.href}">`);
    return [];
  }
  return Array.from(cssRules).flatMap(r => r instanceof CSSImportRule ? (r.styleSheet ? rules(r.styleSheet, links) : []) : [r.cssText]);
}

function styles() {
  const links = [];
  const css = Array.from(document.styleSheets).flatMap(s => rules(s, links));
  return `${links.join('\n')}\n<style>\n${css.join('\n')}\n</style>`;
}

function escape(text) {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export function save(element, fileName, title) {
  const copy = element.cloneNode(true);
  // A checkbox's state is a property, and the copy keeps attributes alone.
  const inputs = element.querySelectorAll('input'), copied = copy.querySelectorAll('input');
  inputs.forEach((input, i) => copied[i].toggleAttribute('checked', input.checked));
  copy.querySelectorAll('[data-save-skip]').forEach(e => e.remove());
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
${styles()}
</head>
<body style="padding: 16px">
<h2>${escape(title)}</h2>
${copy.outerHTML}
</body>
</html>`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
