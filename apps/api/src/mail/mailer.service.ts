import { Injectable } from "@nestjs/common";
import nodemailer from "nodemailer";
import { loadEnv } from "../config/env.js";

@Injectable()
export class MailerService {
  private readonly transport: nodemailer.Transporter;
  private readonly from: string;

  constructor() {
    const env = loadEnv();
    this.from = env.SMTP_FROM;
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
      connectionTimeout: 5000,
      socketTimeout: 5000,
    });
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject, text });
  }
}
