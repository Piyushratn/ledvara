import { Injectable } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }

  async verify(hashed: string, password: string): Promise<boolean> {
    try {
      return await verify(hashed, password);
    } catch {
      return false;
    }
  }
}
