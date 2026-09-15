import { ValidationError } from "@triliumnext/core";

/** A complete retry cannot change the condition that caused this failure. */
export class NonRetryableReadWeaveError extends ValidationError {}

/** A complete answer may succeed when the writer is given more output space. */
export class ReadWeaveOutputLimitError extends NonRetryableReadWeaveError {
    constructor(
        public readonly requestedTokens: number,
        public readonly usedTokens?: number,
        /** Provider output retained only in memory for a bounded protocol
         * recovery. It is never logged, persisted, or shown to the user. */
        public readonly partialContent?: string
    ) {
        super(`模型输出达到本次预留的 ${requestedTokens} token${usedTokens === undefined ? "" : `（已用 ${usedTokens}）`}，正在调整空间重试`);
    }
}
