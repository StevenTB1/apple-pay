// Generated from the Supabase project, then trimmed. One manual change to keep on regeneration:
// transaction.amount is `string`, not `number` — amounts are written and read as exact decimal text.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      shortcut_token: {
        Row: {
          created_at: string
          id: string
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shortcut_token_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction: {
        Row: {
          amount: string | null
          capture_fingerprint: string | null
          captured_at: string | null
          card_label: string | null
          currency: string | null
          event_id: string | null
          excluded: boolean
          id: string
          merchant: string | null
          occurred_at: string
          original_capture: Json | null
          owner_id: string
          received_at: string
          source: Database["public"]["Enums"]["capture_source"]
          source_id: string | null
          updated_at: string
        }
        Insert: {
          amount?: string | null
          capture_fingerprint?: string | null
          captured_at?: string | null
          card_label?: string | null
          currency?: string | null
          event_id?: string | null
          excluded?: boolean
          id?: string
          merchant?: string | null
          occurred_at: string
          original_capture?: Json | null
          owner_id: string
          received_at?: string
          source: Database["public"]["Enums"]["capture_source"]
          source_id?: string | null
          updated_at: string
        }
        Update: {
          amount?: string | null
          capture_fingerprint?: string | null
          captured_at?: string | null
          card_label?: string | null
          currency?: string | null
          event_id?: string | null
          excluded?: boolean
          id?: string
          merchant?: string | null
          occurred_at?: string
          original_capture?: Json | null
          owner_id?: string
          received_at?: string
          source?: Database["public"]["Enums"]["capture_source"]
          source_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      spending_breakdown: {
        Args: { p_owner_id: string; p_start?: string; p_end?: string }
        Returns: {
          dimension: string
          key: string
          purchase_count: number
          total_cad: string
        }[]
      }
      spending_summary: {
        Args: { p_end: string; p_owner_id: string; p_start: string }
        Returns: {
          excluded_count: number
          included_count: number
          needs_review_count: number
          total_cad: string
        }[]
      }
    }
    Enums: {
      capture_source: "APPLE_PAY" | "MANUAL"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
