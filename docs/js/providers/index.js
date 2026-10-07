import { mailgw } from "./mailgw.js";
import { guerrilla } from "./guerrilla.js";
import { discoverBackendProviders } from "./backend.js";

export const providers = [mailgw, guerrilla];

export const DEFAULT_PROVIDER = mailgw.id;

export function getProvider(id) {
  return providers.find((p) => p.id === id) || mailgw;
}

export function hasProvider(id) {
  return providers.some((p) => p.id === id);
}

/**
 * Adds the providers that only work through the optional backend. Ones the
 * browser already reaches directly (Mail.gw, Guerrilla) are skipped.
 */
export async function loadBackendProviders() {
  for (const p of await discoverBackendProviders()) {
    if (!hasProvider(p.id)) providers.push(p);
  }
}
