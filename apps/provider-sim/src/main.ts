import { DEFAULT_CONFIG } from "./config.js";
import { makeHttpSender } from "./http-sender.js";
import { mulberry32 } from "./rng.js";
import { buildServer } from "./server.js";
import { ProviderSim } from "./simulator.js";

const port = Number(process.env.PROVIDER_SIM_PORT ?? 4000);
const apiKey = process.env.PROVIDER_SIM_API_KEY ?? "sim-dev-key";
const callbackUrl =
  process.env.PROVIDER_CALLBACK_URL ?? "http://localhost:3000/v1/provider/callbacks";
const callbackSecret = process.env.PROVIDER_CALLBACK_SECRET ?? "sim-dev-callback-secret";
const seed = Number(process.env.PROVIDER_SIM_SEED ?? Date.now());

const sim = new ProviderSim({
  config: DEFAULT_CONFIG,
  rng: mulberry32(seed),
  send: makeHttpSender(callbackUrl, callbackSecret),
  onError: (error, event) => {
    console.error(
      `callback ${event.type} for ${event.payoutRef} failed:`,
      error instanceof Error ? error.message : error,
    );
  },
});

const app = buildServer(sim, apiKey);
await app.listen({ port, host: "0.0.0.0" });
console.log(`Provider simulator on http://localhost:${port} (callbacks to ${callbackUrl})`);

const stop = (): void => {
  void app.close().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
