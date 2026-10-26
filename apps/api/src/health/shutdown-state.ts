import { Injectable } from "@nestjs/common";

@Injectable()
export class ShutdownState {
  private shuttingDown = false;

  begin(): void {
    this.shuttingDown = true;
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }
}
