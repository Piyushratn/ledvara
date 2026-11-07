import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { configPatchSchema } from "./config.js";
import { applyReportFaults, NO_FAULTS, type ReportFaults } from "./report-faults.js";
import { ProviderSim, SimError } from "./simulator.js";

const createSchema = z.object({
  reference: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  destinationLabel: z.string().trim().min(1).max(100),
});

const amountString = z.string().regex(/^\d+$/u);

const faultsSchema = z.object({
  drop: z.array(z.string().max(200)).max(1000).default([]),
  amountOverrides: z.record(z.string(), amountString).default({}),
  statusOverrides: z.record(z.string(), z.enum(["settled", "failed"])).default({}),
  extra: z
    .array(
      z.object({
        providerRef: z.string().min(1).max(100),
        reference: z.string().min(1).max(200),
        amountMinor: amountString,
        status: z.enum(["settled", "failed"]),
      }),
    )
    .max(1000)
    .default([]),
});

function keyMatches(expected: string, provided: unknown): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildServer(sim: ProviderSim, apiKey: string): FastifyInstance {
  const app = Fastify({ logger: false });
  // Faults affect only the settlement report, never the payouts themselves.
  let faults: ReportFaults = NO_FAULTS;

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SimError) {
      return reply
        .status(error.status)
        .send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof z.ZodError) {
      return reply.status(422).send({
        error: { code: "validation_failed", message: "Invalid request", details: error.issues },
      });
    }
    return reply
      .status(500)
      .send({ error: { code: "internal_error", message: "Unexpected error" } });
  });

  app.get("/healthz", () => ({ status: "ok" }));

  app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/healthz") return;
    if (!keyMatches(apiKey, request.headers["x-provider-key"])) {
      await reply
        .status(401)
        .send({ error: { code: "unauthorized", message: "Missing or wrong provider key." } });
    }
  });

  app.post("/payouts", async (request, reply) => {
    const input = createSchema.parse(request.body);
    const { record, created } = sim.create({
      reference: input.reference,
      amountMinor: BigInt(input.amountMinor),
      destinationLabel: input.destinationLabel,
    });
    return reply.status(created ? 202 : 200).send({
      id: record.id,
      reference: record.reference,
      status: record.status,
      amountMinor: record.amountMinor.toString(),
    });
  });

  app.get<{ Params: { id: string } }>("/payouts/:id", async (request, reply) => {
    const record = sim.get(request.params.id);
    if (!record) {
      return reply.status(404).send({ error: { code: "not_found", message: "Payout not found." } });
    }
    return {
      id: record.id,
      reference: record.reference,
      status: record.status,
      amountMinor: record.amountMinor.toString(),
    };
  });

  app.get("/settlement-report", () => ({
    data: applyReportFaults(sim.settlementReport(), faults),
  }));

  app.get("/admin/config", () => sim.getConfig());

  app.put("/admin/config", (request) => sim.setConfig(configPatchSchema.parse(request.body)));

  // Replaces the whole fault set. Send {} to clear all faults.
  app.put("/admin/report-faults", (request) => {
    faults = faultsSchema.parse(request.body ?? {});
    return faults;
  });

  return app;
}
