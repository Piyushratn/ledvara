import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AccessTokenGuard } from "./auth/access-token.guard.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { LoginThrottleService } from "./auth/login-throttle.service.js";
import { PasswordResetService } from "./auth/password-reset.service.js";
import { PasswordService } from "./auth/password.service.js";
import { SessionsController } from "./auth/sessions.controller.js";
import { SessionsService } from "./auth/sessions.service.js";
import { TwoFactorService } from "./auth/two-factor.service.js";
import { Dependencies } from "./health/dependencies.js";
import { HealthController } from "./health/health.controller.js";
import { ShutdownState } from "./health/shutdown-state.js";
import { MailerService } from "./mail/mailer.service.js";
import { InvitesController } from "./orgs/invites.controller.js";
import { InvitesService } from "./orgs/invites.service.js";
import { OrgsController } from "./orgs/orgs.controller.js";
import { OrgsService } from "./orgs/orgs.service.js";
import { OrgPermissionGuard } from "./orgs/org-permission.guard.js";
import { MembersController } from "./orgs/members.controller.js";
import { MembersService } from "./orgs/members.service.js";
import { ApiKeysController } from "./api-keys/api-keys.controller.js";
import { ApiKeysService } from "./api-keys/api-keys.service.js";
import { ApiKeyGuard } from "./api-keys/api-key.guard.js";
import { WhoAmIController } from "./api-keys/whoami.controller.js";
import { AuditController } from "./audit/audit.controller.js";
import { AuditService } from "./audit/audit.service.js";
import { LedgerService } from "./ledger/ledger.service.js";
import { TransitionService } from "./ledger/transition.service.js";
import { IdempotencyService } from "./ledger/idempotency.service.js";
import { TransfersController } from "./ledger/transfers.controller.js";
import { TransfersService } from "./ledger/transfers.service.js";
import { AccountsController } from "./ledger/accounts.controller.js";
import { AccountsService } from "./ledger/accounts.service.js";
import { TransfersListService } from "./ledger/transfers-list.service.js";
import { ReversalsService } from "./ledger/reversals.service.js";
import { RefundsService } from "./ledger/refunds.service.js";
import { PayoutsController } from "./ledger/payouts.controller.js";
import { PayoutsService } from "./ledger/payouts.service.js";

@Module({
  controllers: [
    AppController,
    HealthController,
    AuditController,
    AuthController,
    SessionsController,
    OrgsController,
    InvitesController,
    MembersController,
    ApiKeysController,
    WhoAmIController,
    TransfersController,
    AccountsController,
    PayoutsController,
  ],
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
    TwoFactorService,
    OrgsService,
    InvitesService,
    OrgPermissionGuard,
    MembersService,
    ApiKeysService,
    ApiKeyGuard,
    AuditService,
    LedgerService,
    TransitionService,
    IdempotencyService,
    TransfersService,
    AccountsService,
    TransfersListService,
    ReversalsService,
    RefundsService,
    PayoutsService,
  ],
})
export class AppModule {}
