import { ValidationError } from "@triliumnext/core";

/** A complete retry cannot change the condition that caused this failure. */
export class NonRetryableReadWeaveError extends ValidationError {}
