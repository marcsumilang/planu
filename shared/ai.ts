import type { ItemType } from "./planu";

export interface RouteCaptureResult {
  type: ItemType;
  title: string;
  dueAt?: number;
  priority: 1 | 2 | 3;
  confidence: number;
  projectName?: string;
  tags: string[];
  needsSynthesis: boolean;
}

export interface ExtractedTask {
  title: string;
  dueAt?: number;
  priority: 1 | 2 | 3;
}

export interface ExtractTasksResult {
  tasks: ExtractedTask[];
}

export interface DayPlanEntry {
  itemId: string;
  timeSlot: string;
  reason: string;
}

export interface DayPlanResult {
  schedule: DayPlanEntry[];
  summary: string;
}

export interface BreakdownResult {
  subtasks: ExtractedTask[];
}

export interface HabitCoachResult {
  observation: string;
  suggestion?: string;
}
