export function cleanTodoText(value: string): string {
  return value.trim().slice(0, 160);
}
