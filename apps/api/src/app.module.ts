import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { Dependencies } from "./health/dependencies.js";
import { HealthController } from "./health/health.controller.js";

@Module({
  controllers: [AppController, HealthController],
  providers: [Dependencies],
})
export class AppModule {}
