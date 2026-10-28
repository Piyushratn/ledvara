import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AccessTokenGuard } from "./auth/access-token.guard.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { LoginThrottleService } from "./auth/login-throttle.service.js";
import { PasswordResetService } from "./auth/password-reset.service.js";
import { PasswordService } from "./auth/password.service.js";
import { SessionsService } from "./auth/sessions.service.js";
import { Dependencies } from "./health/dependencies.js";
import { HealthController } from "./health/health.controller.js";
import { ShutdownState } from "./health/shutdown-state.js";
import { MailerService } from "./mail/mailer.service.js";

@Module({
  controllers: [AppController, HealthController, AuthController],
  providers: [
    Dependencies,
    ShutdownState,
    AuthService,
    PasswordService,
    PasswordResetService,
    MailerService,
    SessionsService,
    AccessTokenGuard,
    LoginThrottleService,
  ],
})
export class AppModule {}
