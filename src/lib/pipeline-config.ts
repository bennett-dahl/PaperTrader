import { DEFAULT_PIPELINE_CONFIG, INHERITABLE_FIELDS } from "./pipeline-defaults";
import type { StrategyTemplate } from "@/db/schema";

type PipelineInput = Partial<Record<typeof INHERITABLE_FIELDS[number], unknown>>;

export function resolveConfig(
  template: StrategyTemplate | null,
  userInput: PipelineInput
): { resolved: typeof DEFAULT_PIPELINE_CONFIG & { thesis: string }; overrides: string[] } {
  const base = template ?? DEFAULT_PIPELINE_CONFIG;
  const overrides: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolved: any = { ...base };

  for (const field of INHERITABLE_FIELDS) {
    if (field in userInput && userInput[field] !== undefined) {
      const templateValue = (base as Record<string, unknown>)[field];
      const userValue = userInput[field];
      // Track as override if it differs from template/default
      if (JSON.stringify(userValue) !== JSON.stringify(templateValue)) {
        overrides.push(field);
      }
      resolved[field] = userValue;
    }
  }

  return { resolved, overrides };
}
