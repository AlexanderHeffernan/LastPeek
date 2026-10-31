import { z } from "zod";

// Register experiments here. Absence of an account grant always means disabled.
export const featureSchema = z.enum(["ai-review", "x-source-posts"]);
export type Feature = z.infer<typeof featureSchema>;
