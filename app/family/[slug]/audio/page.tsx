/**
 * /family/<slug>/audio#t=<seconds>: where a family book's notes link. The same recording page,
 * opened at the cited moment (the fragment never reaches the server; the page reads it).
 */
import FamilyRecordPage from "../page";

export { generateMetadata } from "../page";
export const dynamic = "force-dynamic";
export default FamilyRecordPage;
