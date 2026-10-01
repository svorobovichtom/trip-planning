import { createContext, type RefObject, useContext } from "react";

/** The one scroll container under the fixed header (see App). */
export const ScrollContext = createContext<RefObject<HTMLDivElement | null>>({ current: null });
export const useScrollEl = () => useContext(ScrollContext);
