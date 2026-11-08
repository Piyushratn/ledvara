import { client } from "./client";

export async function signUp(input: {
  email: string;
  password: string;
  fullName?: string;
}): Promise<void> {
  await client.request("/v1/auth/signup", { method: "POST", body: input, auth: false });
}

export async function verifyEmail(token: string): Promise<void> {
  await client.request("/v1/auth/verify-email", {
    method: "POST",
    body: { token },
    auth: false,
  });
}
