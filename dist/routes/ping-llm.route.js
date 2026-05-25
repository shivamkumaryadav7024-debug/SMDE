import { getLLMProvider } from "../llm/factory.js";
export async function pingLlmRoute(app) {
    app.get("/ping-llm", async (_req, reply) => {
        const llm = getLLMProvider();
        const response = await llm.generateText("hi");
        return reply.send({ message: response });
    });
}
//# sourceMappingURL=ping-llm.route.js.map