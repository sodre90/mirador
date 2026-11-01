import { useEffect } from "react";

const APP_NAME = "Mirador";

export const tabTitle = (waitingCount: number) => (waitingCount > 0 ? `(${waitingCount}) ${APP_NAME}` : APP_NAME);

export function useTabTitle(waitingCount: number) {
  useEffect(() => {
    document.title = tabTitle(waitingCount);
  }, [waitingCount]);
}
