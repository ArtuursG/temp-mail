import { mailgw } from "./mailgw.js";
import { guerrilla } from "./guerrilla.js";

export const providers = [mailgw, guerrilla];

export const DEFAULT_PROVIDER = mailgw.id;

export function getProvider(id) {
  return providers.find((p) => p.id === id) || mailgw;
}
