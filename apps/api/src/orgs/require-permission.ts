import { SetMetadata } from "@nestjs/common";
import type { Permission } from "./permissions.js";

export const PERMISSION_KEY = "required_permission";
export const RequirePermission = (permission: Permission): MethodDecorator =>
  SetMetadata(PERMISSION_KEY, permission);
