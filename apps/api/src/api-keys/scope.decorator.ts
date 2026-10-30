import { SetMetadata } from "@nestjs/common";
import type { ApiKeyScope } from "./scopes.js";

export const SCOPE_KEY = "required_scope";
export const RequireScope = (scope: ApiKeyScope): MethodDecorator => SetMetadata(SCOPE_KEY, scope);
