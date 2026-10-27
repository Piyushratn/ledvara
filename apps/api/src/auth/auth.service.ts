import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { Dependencies } from "../health/dependencies.js";
import type { SignUpInput } from "./auth.schemas.js";
import { PasswordService } from "./password.service.js";

@Injectable()
export class AuthService {
  constructor(
    @Inject(Dependencies) private readonly deps: Dependencies,
    @Inject(PasswordService) private readonly passwords: PasswordService,
  ) {}

  async signUp(input: SignUpInput): Promise<void> {
    const passwordHash = await this.passwords.hash(input.password);
    await this.deps.db
      .insert(schema.users)
      .values({ email: input.email, passwordHash, fullName: input.fullName ?? null })
      .onConflictDoNothing({ target: schema.users.email });
  }
}
