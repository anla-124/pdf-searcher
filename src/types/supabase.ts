type GenericTable = {
  Row: Record<string, unknown>
  Insert: Record<string, unknown>
  Update: Record<string, unknown>
  Relationships: never[]
}

type GenericView = {
  Row: Record<string, unknown>
  Relationships: never[]
}

type GenericFunction = {
  Args: Record<string, unknown>
  Returns: unknown
}

export type GenericSupabaseSchema = {
  public: {
    Tables: Record<string, GenericTable>
    Views: Record<string, GenericView>
    Functions: Record<string, GenericFunction>
  }
} & Record<string, {
  Tables: Record<string, GenericTable>
  Views: Record<string, GenericView>
  Functions: Record<string, GenericFunction>
}>
