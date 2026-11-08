import { API_URL } from "./config";
import { createClient, createTokenStore } from "./http";

export const tokens = createTokenStore();
export const client = createClient({ baseUrl: API_URL, tokens });
