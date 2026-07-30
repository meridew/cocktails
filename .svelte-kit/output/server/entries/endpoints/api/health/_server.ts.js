import { json } from "@sveltejs/kit";
import { t as now } from "../../../../chunks/db.js";
const GET = () => json({ ok: true, now: now() });
export {
  GET
};
