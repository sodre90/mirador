/** A fence longer than any run of backticks in the code, so the code cannot close it. */
export function fenced(code: string, language: string) {
  const longestRun = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}
