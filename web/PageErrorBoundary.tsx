import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "./i18n/index.ts";
import { reportPageError } from "./page-errors.ts";

/** Without it, an error while rendering unmounts the whole page and leaves it blank. */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { broke: boolean }> {
  state = { broke: false };

  static getDerivedStateFromError() {
    return { broke: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    reportPageError(error, info.componentStack ?? "");
  }

  render() {
    if (!this.state.broke) return this.props.children;
    return (
      <div className="page-broke" role="alert">
        <h1>{t.shell.pageBroke.title}</h1>
        <p>{t.shell.pageBroke.detail}</p>
        <button onClick={() => location.reload()}>{t.shell.pageBroke.reload}</button>
      </div>
    );
  }
}
