import * as z from "zod"

export const OmoFilePickerSettingsSchema = z
  .object({
    ignore_gitignore: z.union([z.boolean(), z.literal("ask")]).optional(),
  })
  .strict()

export const OmoFilePickerSettingsLayerSchema = OmoFilePickerSettingsSchema
