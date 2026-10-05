import { boolean, capsule, endpoint, mutation, query, string, table, text, userId } from "lakebed/server";
import { cleanTodoText } from "../shared/todo";

export default capsule({
  name: "planu",

  auth: { requireSignIn: false },

  schema: {
    todos: table({
      text: string(),
      done: boolean().default(false),
      ownerId: userId()
    }).index("by_owner", ["ownerId"])
  },

  queries: {
    todos: query(async (ctx) => {
      const { userId } = ctx.auth.requireIdentity();
      return ctx.db.todos
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .order("desc")
        .collect();
    })
  },

  mutations: {
    addTodo: mutation(async (ctx, text: string) => {
      const { userId } = ctx.auth.requireIdentity();
      const cleanText = cleanTodoText(text);
      if (!cleanText) {
        return;
      }

      await ctx.db.todos.insert({ text: cleanText, ownerId: userId });
    })
  },

  endpoints: {
    status: endpoint({ method: "GET", path: "/api/status" }, () => text("ok"))
  }
});
