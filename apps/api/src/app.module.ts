import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { Dependencies } from "./health/dependencies.js";
import { HealthController } from "./health/health.controller.js";
import { ShutdownState } from "./health/shutdown-state.js";

@Module({
  controllers: [AppController, HealthController],
  providers: [Dependencies, ShutdownState],
})
export class AppModule {}
