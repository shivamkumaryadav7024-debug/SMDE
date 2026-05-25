import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
export declare class AppError extends Error {
    readonly code: string;
    readonly extractionId?: string | undefined;
    readonly retryAfterMs?: number | undefined;
    constructor(code: string, message: string, extractionId?: string | undefined, retryAfterMs?: number | undefined);
}
export declare function errorHandler(error: FastifyError | AppError | Error, _request: FastifyRequest, reply: FastifyReply): FastifyReply<import("fastify").RouteGenericInterface, import("fastify").RawServerDefault, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, unknown, import("fastify").FastifySchema, import("fastify").FastifyTypeProviderDefault, unknown>;
//# sourceMappingURL=errorHandler.d.ts.map