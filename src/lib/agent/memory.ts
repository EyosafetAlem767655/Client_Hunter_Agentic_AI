import {
  countDomainSendsInWindow,
  countEmailsSentToday,
  createAgentRun,
  createOutreachEmail,
  finishAgentRun,
  getExistingExternalIds,
  getFeedbackExamples,
  getLlmCache,
  getSetting,
  getOutreachById,
  insertFilteredJob,
  listApprovedOutreach,
  listJobsNeedingDraft,
  listPendingOutreach,
  listTopRelevantWithoutContacts,
  listUnfilteredPostings,
  recordDomainSend,
  setLlmCache,
  setSetting,
  updateOutreachStatus,
  upsertContact,
  upsertJobPosting,
} from "@/lib/db/queries";
import { sha256Hex } from "@/lib/hash";
import type { RawPosting } from "@/types";
import { PROMPT_VERSION } from "@/lib/llm/prompts";

export const memory = {
  upsertJobPosting,
  getExistingExternalIds,
  listUnfilteredPostings,
  insertFilteredJob,
  getFeedbackExamples,
  listTopRelevantWithoutContacts,
  upsertContact,
  listJobsNeedingDraft,
  createOutreachEmail,
  listApprovedOutreach,
  listPendingOutreach,
  updateOutreachStatus,
  getOutreachById,
  countEmailsSentToday,
  countDomainSendsInWindow,
  recordDomainSend,
  createAgentRun,
  finishAgentRun,
  getSetting,
  setSetting,

  async getCachedLlm(
    model: string,
    inputHash: string
  ): Promise<Record<string, unknown> | null> {
    const key = sha256Hex(`${PROMPT_VERSION}:${model}:${inputHash}`);
    const row = await getLlmCache(key);
    return row?.response ?? null;
  },

  async setCachedLlm(
    model: string,
    inputHash: string,
    response: Record<string, unknown>
  ): Promise<void> {
    const key = sha256Hex(`${PROMPT_VERSION}:${model}:${inputHash}`);
    await setLlmCache(key, model, response);
  },
};

export type MemoryLayer = typeof memory;

export async function filterNewPostings(
  postings: RawPosting[]
): Promise<RawPosting[]> {
  const bySource = new Map<string, RawPosting[]>();
  for (const p of postings) {
    const list = bySource.get(p.source) ?? [];
    list.push(p);
    bySource.set(p.source, list);
  }

  const result: RawPosting[] = [];
  for (const [source, list] of Array.from(bySource.entries())) {
    const ids = list.map((p: RawPosting) => p.externalId);
    const existing = await getExistingExternalIds(source, ids);
    result.push(...list.filter((p: RawPosting) => !existing.has(p.externalId)));
  }
  return result;
}
