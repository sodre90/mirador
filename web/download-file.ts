const DOWNLOAD_LINK_LIFETIME_MS = 60_000;

export function downloadFile(name: string, content: Blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(content);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), DOWNLOAD_LINK_LIFETIME_MS);
}
