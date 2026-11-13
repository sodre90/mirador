/** The stylesheet draws Mirador's own text cursor over text fields where the root element's data-text-cursor says so. */
export function applyTextCursor(userAgent = navigator.userAgent) {
  if (/Windows/.test(userAgent)) document.documentElement.dataset.textCursor = "drawn";
}
