import type { SessionConfigSelectOption } from "@agentclientprotocol/sdk/unstable";
import { modelPrice, type ModelPrice } from "../shared/config-options.ts";
import { t } from "./i18n/index.ts";

/** The model's name, followed by its price category and its multiplier where it has them. */
export const withPrice = (name: string, price: ModelPrice | null) =>
  [name, price?.category && t.shell.statusline.priceCategories[price.category], price?.multiplier].filter(Boolean).join(" · ");

export const nameWithPrice = (choice: SessionConfigSelectOption) => withPrice(choice.name, modelPrice(choice));
