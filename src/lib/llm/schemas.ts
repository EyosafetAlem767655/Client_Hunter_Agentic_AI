import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const FilteredJobSchema = z.object({
  isRelevant: z.boolean(),
  score: z.number().min(0).max(100),
  roleCategory: z.string(),
  fitReason: z.string(),
  suggestedRegions: z.array(z.string()),
  estimatedSalaryRange: z.string(),
});

export const FilteredJobBatchSchema = z.object({
  results: z.array(
    z.object({
      postingIndex: z.number().int().min(0),
      job: FilteredJobSchema,
    })
  ),
});

export const DraftedEmailSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(100).max(1500),
});

export type FilteredJob = z.infer<typeof FilteredJobSchema>;
export type DraftedEmail = z.infer<typeof DraftedEmailSchema>;

export const filteredJobJsonSchema = zodToJsonSchema(FilteredJobBatchSchema, {
  name: "FilteredJobBatch",
});

export const draftedEmailJsonSchema = zodToJsonSchema(DraftedEmailSchema, {
  name: "DraftedEmail",
});

export function parseFilteredBatch(
  raw: unknown
): z.infer<typeof FilteredJobBatchSchema> | null {
  const parsed = FilteredJobBatchSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseDraftedEmail(raw: unknown): DraftedEmail | null {
  const parsed = DraftedEmailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const FALLBACK_FILTERED: FilteredJob = {
  isRelevant: false,
  score: 0,
  roleCategory: "unknown",
  fitReason: "Parse failure — defaulted to not relevant",
  suggestedRegions: [],
  estimatedSalaryRange: "unknown",
};
