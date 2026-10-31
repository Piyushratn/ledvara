import { Injectable } from "@nestjs/common";
import { loadEnv } from "../config/env.js";

@Injectable()
export class ProviderClient {
  private readonly env = loadEnv();

  /** Returns the provider's payout id, or throws. The payout id is our idempotent reference. */
  async createPayout(input: {
    reference: string;
    amountMinor: string;
    destinationLabel: string;
  }): Promise<string> {
    const response = await fetch(`${this.env.PROVIDER_URL}/payouts`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-provider-key": this.env.PROVIDER_API_KEY },
      body: JSON.stringify({
        reference: input.reference,
        amountMinor: Number(input.amountMinor),
        destinationLabel: input.destinationLabel,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Provider answered ${response.status}`);
    const body = (await response.json()) as { id: string };
    return body.id;
  }
}
