import { z } from "zod";
export const skillProviderKindSchema = z.enum(["text", "image", "video", "model3d"]);
export type SkillProviderKind = z.infer<typeof skillProviderKindSchema>;
