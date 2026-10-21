import { initDb } from "@content-os/core";
import { ProductionEngine } from "./src/index.js";
const db = initDb("/opt/docker/apps/content-os/repo/data/content.db");
const eng = new ProductionEngine(db);
const r = eng.edit({targetId:2});
console.log("edit result:", JSON.stringify(r));