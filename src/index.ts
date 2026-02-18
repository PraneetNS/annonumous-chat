import "dotenv/config";
import { buildServer } from "./server.js";

const server = await buildServer();
const { HOST, PORT } = server.config;

await server.listen({ host: HOST, port: PORT });

