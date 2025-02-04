import { apiTree } from "wirejs-resources/client";
const INTERNAL_API_URL = "/api";

export const auth = apiTree(INTERNAL_API_URL, ["auth"]);
export const todos = apiTree(INTERNAL_API_URL, ["todos"]);
export const wiki = apiTree(INTERNAL_API_URL, ["wiki"]);