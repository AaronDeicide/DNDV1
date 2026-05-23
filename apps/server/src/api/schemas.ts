import { z } from "zod";

export const zCreateModule = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable()
});

export const zCreateModuleVersion = z.object({
  markdown: z.string().min(1).max(2_000_000) // 先给较大上限，后续可拆分/上传文件
});

export const zBindCampaignModule = z.object({
  moduleVersionId: z.string().min(1)
});

export const zCreateSave = z.object({
  name: z.string().min(1).max(100)
});

export const zLoadSave = z.object({
  saveId: z.string().min(1)
});

export const zDiceRoll = z.object({
  expression: z.string().min(1).max(40)
});

export const zBotPostMessage = z.object({
  authorName: z.string().min(1).max(80),
  text: z.string().min(1).max(5000),
  kind: z.enum(["CHAT", "SYSTEM", "DM"]).optional()
});

export const zUpsertOnebotBinding = z.object({
  groupId: z.string().min(1).max(40),
  roomId: z.string().min(1)
});
