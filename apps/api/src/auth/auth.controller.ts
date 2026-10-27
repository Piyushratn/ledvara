import { Body, Controller, HttpCode, Inject, Post } from "@nestjs/common";
import { parseOrThrow } from "../validation/parse.js";
import { signUpSchema, verifyEmailSchema } from "./auth.schemas.js";
import { AuthService } from "./auth.service.js";

@Controller("v1/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("signup")
  @HttpCode(202)
  async signUp(@Body() body: unknown): Promise<{ message: string }> {
    const input = parseOrThrow(signUpSchema, body);
    await this.auth.signUp(input);
    return { message: "If this email can be registered, check your inbox to continue." };
  }

  @Post("verify-email")
  @HttpCode(200)
  async verifyEmail(@Body() body: unknown): Promise<{ message: string }> {
    const input = parseOrThrow(verifyEmailSchema, body);
    await this.auth.verifyEmail(input.token);
    return { message: "Email verified." };
  }
}
