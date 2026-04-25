// drizzle-orm/zod is an optional peer — loaded dynamically at runtime.
// Declare the module to satisfy the DTS build; actual types are cast via `as unknown`.
declare module 'drizzle-orm/zod' {
  export const createSelectSchema: unknown
  export const createInsertSchema: unknown
  export const createUpdateSchema: unknown
}
