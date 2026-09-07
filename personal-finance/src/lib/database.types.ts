export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          balance: number
          created_at: string | null
          currency: string
          id: string
          initial_balance: number
          institution: string | null
          is_shared: boolean | null
          last_synced_at: string | null
          name: string
          type: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string | null
          currency?: string
          id?: string
          initial_balance?: number
          institution?: string | null
          is_shared?: boolean | null
          last_synced_at?: string | null
          name: string
          type: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string | null
          currency?: string
          id?: string
          initial_balance?: number
          institution?: string | null
          is_shared?: boolean | null
          last_synced_at?: string | null
          name?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          alert_threshold: number | null
          amount: number
          category_id: string
          created_at: string | null
          id: string
          month: string
          user_id: string
        }
        Insert: {
          alert_threshold?: number | null
          amount: number
          category_id: string
          created_at?: string | null
          id?: string
          month: string
          user_id: string
        }
        Update: {
          alert_threshold?: number | null
          amount?: number
          category_id?: string
          created_at?: string | null
          id?: string
          month?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          budget_type: string | null
          color: string | null
          created_at: string | null
          icon: string | null
          id: string
          is_system: boolean | null
          name: string
          parent_id: string | null
          sort_order: number | null
          type: string
          user_id: string | null
        }
        Insert: {
          budget_type?: string | null
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          parent_id?: string | null
          sort_order?: number | null
          type: string
          user_id?: string | null
        }
        Update: {
          budget_type?: string | null
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          parent_id?: string | null
          sort_order?: number | null
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      csv_imports: {
        Row: {
          account_id: string
          completed_at: string | null
          created_at: string | null
          errors: Json | null
          file_hash: string
          file_name: string
          id: string
          metadata: Json
          rows_duplicate: number
          rows_failed: number
          rows_imported: number
          rows_invalid: number
          rows_skipped: number
          rows_total: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          created_at?: string | null
          errors?: Json | null
          file_hash: string
          file_name: string
          id?: string
          metadata?: Json
          rows_duplicate?: number
          rows_failed?: number
          rows_imported?: number
          rows_invalid?: number
          rows_skipped?: number
          rows_total: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          created_at?: string | null
          errors?: Json | null
          file_hash?: string
          file_name?: string
          id?: string
          metadata?: Json
          rows_duplicate?: number
          rows_failed?: number
          rows_imported?: number
          rows_invalid?: number
          rows_skipped?: number
          rows_total?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "csv_imports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balance_reconciliation"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "csv_imports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csv_imports_account_owner_fkey"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balance_reconciliation"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "csv_imports_account_owner_fkey"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "csv_imports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          account_id: string | null
          category_id: string | null
          color: string | null
          created_at: string | null
          current_amount: number | null
          icon: string | null
          id: string
          is_shared: boolean | null
          name: string
          target_amount: number
          target_date: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          category_id?: string | null
          color?: string | null
          created_at?: string | null
          current_amount?: number | null
          icon?: string | null
          id?: string
          is_shared?: boolean | null
          name: string
          target_amount: number
          target_date?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          category_id?: string | null
          color?: string | null
          created_at?: string | null
          current_amount?: number | null
          icon?: string | null
          id?: string
          is_shared?: boolean | null
          name?: string
          target_amount?: number
          target_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balance_reconciliation"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "goals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_account_owner_fkey"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balance_reconciliation"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "goals_account_owner_fkey"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "goals_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      household_account_transactions: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          currency: string
          date: string
          description: string
          household_id: string
          id: string
          kind: Database["public"]["Enums"]["transaction_kind"]
          notes: string | null
          recorded_by_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          amount: number
          created_at?: string
          currency: string
          date: string
          description: string
          household_id: string
          id?: string
          kind: Database["public"]["Enums"]["transaction_kind"]
          notes?: string | null
          recorded_by_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          currency?: string
          date?: string
          description?: string
          household_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["transaction_kind"]
          notes?: string | null
          recorded_by_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_account_transactions_account_fkey"
            columns: ["account_id", "household_id"]
            isOneToOne: false
            referencedRelation: "household_account_balance_reconciliation"
            referencedColumns: ["account_id", "household_id"]
          },
          {
            foreignKeyName: "household_account_transactions_account_fkey"
            columns: ["account_id", "household_id"]
            isOneToOne: false
            referencedRelation: "household_accounts"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "household_account_transactions_recorded_by_user_id_fkey"
            columns: ["recorded_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_account_transactions_recorder_membership_fkey"
            columns: ["household_id", "recorded_by_user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
        ]
      }
      household_accounts: {
        Row: {
          balance: number
          closed_at: string | null
          created_at: string
          created_by_user_id: string
          currency: string
          household_id: string
          id: string
          initial_balance: number
          name: string
          status: string
          type: string
        }
        Insert: {
          balance?: number
          closed_at?: string | null
          created_at?: string
          created_by_user_id: string
          currency?: string
          household_id: string
          id?: string
          initial_balance?: number
          name: string
          status?: string
          type: string
        }
        Update: {
          balance?: number
          closed_at?: string | null
          created_at?: string
          created_by_user_id?: string
          currency?: string
          household_id?: string
          id?: string
          initial_balance?: number
          name?: string
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_accounts_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_accounts_creator_membership_fkey"
            columns: ["household_id", "created_by_user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "household_accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_contributions: {
        Row: {
          cancelled_at: string | null
          cancelled_by_user_id: string | null
          contributed_by_user_id: string
          created_at: string
          household_account_transaction_id: string
          household_id: string
          id: string
          idempotency_key: string
          personal_transaction_id: string
          recorded_by_user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          contributed_by_user_id: string
          created_at?: string
          household_account_transaction_id: string
          household_id: string
          id?: string
          idempotency_key: string
          personal_transaction_id: string
          recorded_by_user_id: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          contributed_by_user_id?: string
          created_at?: string
          household_account_transaction_id?: string
          household_id?: string
          id?: string
          idempotency_key?: string
          personal_transaction_id?: string
          recorded_by_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_contributions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_contributions_personal_transaction_fkey"
            columns: ["personal_transaction_id", "contributed_by_user_id"]
            isOneToOne: true
            referencedRelation: "transactions"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "household_contributions_household_transaction_fkey"
            columns: ["household_account_transaction_id", "household_id"]
            isOneToOne: true
            referencedRelation: "household_account_transactions"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      household_expense_splits: {
        Row: {
          amount: number
          household_expense_id: string
          user_id: string
        }
        Insert: {
          amount: number
          household_expense_id: string
          user_id: string
        }
        Update: {
          amount?: number
          household_expense_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_expense_splits_household_expense_id_fkey"
            columns: ["household_expense_id"]
            isOneToOne: false
            referencedRelation: "household_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_expense_splits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      household_expenses: {
        Row: {
          category_id: string | null
          created_at: string
          funding_source: string
          household_account_transaction_id: string | null
          household_id: string
          id: string
          personal_payer_user_id: string | null
          personal_transaction_id: string | null
          recorded_by_user_id: string
          split_mode: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          funding_source: string
          household_account_transaction_id?: string | null
          household_id: string
          id?: string
          personal_payer_user_id?: string | null
          personal_transaction_id?: string | null
          recorded_by_user_id: string
          split_mode: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          funding_source?: string
          household_account_transaction_id?: string | null
          household_id?: string
          id?: string
          personal_payer_user_id?: string | null
          personal_transaction_id?: string | null
          recorded_by_user_id?: string
          split_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_expenses_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_expenses_household_source_fkey"
            columns: ["household_account_transaction_id", "household_id"]
            isOneToOne: false
            referencedRelation: "household_account_transactions"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "household_expenses_payer_membership_fkey"
            columns: ["household_id", "personal_payer_user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "household_expenses_personal_source_fkey"
            columns: ["personal_transaction_id", "personal_payer_user_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "household_expenses_recorded_by_user_id_fkey"
            columns: ["recorded_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_expenses_recorder_membership_fkey"
            columns: ["household_id", "recorded_by_user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
        ]
      }
      household_invitations: {
        Row: {
          created_at: string
          expires_at: string
          household_id: string
          id: string
          invited_by_user_id: string
          invited_email: string
          resolved_at: string | null
          status: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          household_id: string
          id?: string
          invited_by_user_id: string
          invited_email: string
          resolved_at?: string | null
          status?: string
          token_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          household_id?: string
          id?: string
          invited_by_user_id?: string
          invited_email?: string
          resolved_at?: string | null
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_invitations_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_invitations_invited_by_user_id_fkey"
            columns: ["invited_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_invitations_inviter_membership_fkey"
            columns: ["household_id", "invited_by_user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
        ]
      }
      household_members: {
        Row: {
          ended_at: string | null
          household_id: string
          joined_at: string
          status: string
          user_id: string
        }
        Insert: {
          ended_at?: string | null
          household_id: string
          joined_at?: string
          status?: string
          user_id: string
        }
        Update: {
          ended_at?: string | null
          household_id?: string
          joined_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          activated_at: string | null
          closed_at: string | null
          created_at: string
          created_by_user_id: string
          currency: string
          id: string
          name: string
          status: string
        }
        Insert: {
          activated_at?: string | null
          closed_at?: string | null
          created_at?: string
          created_by_user_id: string
          currency?: string
          id?: string
          name: string
          status?: string
        }
        Update: {
          activated_at?: string | null
          closed_at?: string | null
          created_at?: string
          created_by_user_id?: string
          currency?: string
          id?: string
          name?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "households_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "households_creator_membership_fkey"
            columns: ["id", "created_by_user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          currency: string | null
          display_name: string
          id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          currency?: string | null
          display_name: string
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          currency?: string | null
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      split_rules: {
        Row: {
          created_at: string | null
          id: string
          is_default: boolean | null
          name: string
          ratios: Json
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          ratios: Json
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          ratios?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "split_rules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          account_id: string | null
          amount: number
          billing_cycle: string
          category_id: string | null
          created_at: string | null
          currency: string | null
          detection_confidence: number | null
          id: string
          last_charge_date: string | null
          name: string
          next_charge_date: string
          status: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          billing_cycle: string
          category_id?: string | null
          created_at?: string | null
          currency?: string | null
          detection_confidence?: number | null
          id?: string
          last_charge_date?: string | null
          name: string
          next_charge_date: string
          status?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          billing_cycle?: string
          category_id?: string | null
          created_at?: string | null
          currency?: string | null
          detection_confidence?: number | null
          id?: string
          last_charge_date?: string | null
          name?: string
          next_charge_date?: string
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balance_reconciliation"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "subscriptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_account_owner_fkey"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balance_reconciliation"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "subscriptions_account_owner_fkey"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "subscriptions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string | null
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string | null
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string | null
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_tags: {
        Row: {
          tag_id: string
          transaction_id: string
        }
        Insert: {
          tag_id: string
          transaction_id: string
        }
        Update: {
          tag_id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_tags_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          amount: number
          category_id: string | null
          created_at: string | null
          csv_import_id: string | null
          currency: string
          date: string
          description: string
          external_id: string | null
          id: string
          import_match_hash: string | null
          is_shared: boolean | null
          kind: Database["public"]["Enums"]["transaction_kind"]
          notes: string | null
          source: string | null
          source_provider: string | null
          split_ratio: Json | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          category_id?: string | null
          created_at?: string | null
          csv_import_id?: string | null
          currency?: string
          date: string
          description: string
          external_id?: string | null
          id?: string
          import_match_hash?: string | null
          is_shared?: boolean | null
          kind: Database["public"]["Enums"]["transaction_kind"]
          notes?: string | null
          source?: string | null
          source_provider?: string | null
          split_ratio?: Json | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          category_id?: string | null
          created_at?: string | null
          csv_import_id?: string | null
          currency?: string
          date?: string
          description?: string
          external_id?: string | null
          id?: string
          import_match_hash?: string | null
          is_shared?: boolean | null
          kind?: Database["public"]["Enums"]["transaction_kind"]
          notes?: string | null
          source?: string | null
          source_provider?: string | null
          split_ratio?: Json | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balance_reconciliation"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_account_owner_fkey"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "account_balance_reconciliation"
            referencedColumns: ["account_id", "user_id"]
          },
          {
            foreignKeyName: "transactions_account_owner_fkey"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_csv_import_id_fkey"
            columns: ["csv_import_id"]
            isOneToOne: false
            referencedRelation: "csv_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      account_balance_reconciliation: {
        Row: {
          account_id: string | null
          drift: number | null
          expected_balance: number | null
          initial_balance: number | null
          ledger_impact: number | null
          stored_balance: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      household_account_balance_reconciliation: {
        Row: {
          account_id: string | null
          drift: number | null
          expected_balance: number | null
          household_id: string | null
          initial_balance: number | null
          ledger_impact: number | null
          stored_balance: number | null
        }
        Relationships: [
          {
            foreignKeyName: "household_accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_household_invitation: {
        Args: { p_invitation_token: string }
        Returns: string
      }
      close_household_account: { Args: { p_account_id: string }; Returns: Json }
      cancel_household_contribution: {
        Args: { p_contribution_id: string }
        Returns: Json
      }
      create_personal_account: {
        Args: {
          p_name: string
          p_type: string
          p_initial_balance: string
          p_is_shared?: boolean
          p_institution?: string | null
        }
        Returns: Json
      }
      create_personal_transaction_exact: {
        Args: {
          p_account_id: string
          p_kind: Database["public"]["Enums"]["transaction_kind"]
          p_amount: string
          p_date: string
          p_description: string
          p_category_id?: string | null
          p_notes?: string | null
          p_is_shared?: boolean
          p_split_ratio?: Json | null
          p_status?: string
          p_tag_ids?: string[]
        }
        Returns: Json
      }
      create_financial_transaction: {
        Args: {
          p_account_id: string
          p_amount: number
          p_category_id?: string | null
          p_currency: string
          p_date: string
          p_description: string
          p_external_id?: string | null
          p_is_shared?: boolean
          p_kind: Database["public"]["Enums"]["transaction_kind"]
          p_notes?: string | null
          p_source?: string
          p_split_ratio?: Json | null
          p_status?: string
          p_tag_ids?: string[]
        }
        Returns: {
          account_id: string
          amount: number
          category_id: string | null
          created_at: string | null
          csv_import_id: string | null
          currency: string
          date: string
          description: string
          external_id: string | null
          id: string
          import_match_hash: string | null
          is_shared: boolean | null
          kind: Database["public"]["Enums"]["transaction_kind"]
          notes: string | null
          source: string | null
          source_provider: string | null
          split_ratio: Json | null
          status: string
          updated_at: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_household: { Args: { p_name: string }; Returns: string }
      create_household_account: {
        Args: {
          p_household_id: string
          p_initial_balance?: string
          p_name: string
          p_type: string
        }
        Returns: Json
      }
      create_household_account_income: {
        Args: {
          p_account_id: string
          p_amount: string
          p_date: string
          p_description: string
          p_notes?: string | null
          p_status?: string
        }
        Returns: Json
      }
      create_household_invitation: {
        Args: { p_household_id: string; p_invited_email: string }
        Returns: {
          expires_at: string
          invitation_id: string
          invitation_token: string
        }[]
      }
      create_shared_expense: {
        Args: {
          p_amount: string
          p_category_id?: string | null
          p_date: string
          p_description: string
          p_funding_source: string
          p_household_id: string
          p_notes?: string | null
          p_source_account_id: string
          p_split_mode: string
          p_splits?: Json | null
          p_status?: string
        }
        Returns: Json
      }
      csv_import_match_hash: {
        Args: {
          p_amount: number
          p_date: string
          p_description: string
          p_kind: Database["public"]["Enums"]["transaction_kind"]
        }
        Returns: string
      }
      delete_financial_transaction: { Args: { p_id: string }; Returns: string }
      delete_personal_transaction: {
        Args: { p_transaction_id: string }
        Returns: string
      }
      delete_household_account_income: {
        Args: { p_transaction_id: string }
        Returns: string
      }
      delete_shared_expense: { Args: { p_expense_id: string }; Returns: string }
      get_current_household: { Args: never; Returns: Json }
      get_dashboard_summary: { Args: { p_period: string }; Returns: Json }
      get_archived_household: { Args: { p_household_id: string }; Returns: Json }
      get_archived_households: { Args: never; Returns: Json }
      get_household_activity_page: {
        Args: {
          p_household_id: string
          p_limit?: number
          p_before_date?: string | null
          p_before_created_at?: string | null
          p_before_id?: string | null
        }
        Returns: Json
      }
      create_household_contribution: {
        Args: {
          p_amount: string
          p_date: string
          p_destination_household_account_id: string
          p_household_id: string
          p_idempotency_key: string
          p_note: string | null
          p_source_personal_account_id: string
        }
        Returns: Json
      }
      get_household_accounts: {
        Args: { p_household_id: string }
        Returns: Json
      }
      get_household_balance_between_members: {
        Args: { p_household_id: string }
        Returns: Json
      }
      get_household_expenses: {
        Args: { p_household_id: string; p_limit?: number }
        Returns: Json
      }
      get_household_expense_detail: {
        Args: { p_expense_id: string }
        Returns: Json
      }
      get_household_expenses_page: {
        Args: {
          p_household_id: string
          p_limit?: number
          p_before_date?: string | null
          p_before_created_at?: string | null
          p_before_id?: string | null
        }
        Returns: Json
      }
      get_household_members: { Args: { p_household_id: string }; Returns: Json }
      get_household_transactions: {
        Args: { p_household_id: string; p_limit?: number }
        Returns: Json
      }
      get_personal_account: { Args: { p_account_id: string }; Returns: Json }
      get_personal_accounts: { Args: never; Returns: Json }
      get_personal_transaction: { Args: { p_transaction_id: string }; Returns: Json }
      get_personal_transactions: {
        Args: {
          p_account_id?: string | null
          p_category_id?: string | null
          p_start_date?: string | null
          p_end_date?: string | null
          p_limit?: number
          p_offset?: number
        }
        Returns: Json
      }
      import_csv_transactions_batch: {
        Args: { p_category_id: string | null; p_import_id: string; p_rows: Json }
        Returns: {
          error_code: string | null
          error_message: string | null
          result_status: string
          row_number: number
          transaction_id: string | null
        }[]
      }
      leave_household: { Args: { p_household_id: string }; Returns: undefined }
      preview_csv_import_rows: {
        Args: { p_account_id: string; p_rows: Json; p_source_provider: string }
        Returns: {
          possible_duplicate: boolean
          row_number: number
          strong_duplicate: boolean
        }[]
      }
      reject_household_invitation: {
        Args: { p_invitation_token: string }
        Returns: undefined
      }
      revoke_household_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      update_financial_transaction: {
        Args: {
          p_account_id: string
          p_amount: number
          p_category_id: string | null
          p_currency: string
          p_date: string
          p_description: string
          p_id: string
          p_is_shared: boolean
          p_kind: Database["public"]["Enums"]["transaction_kind"]
          p_notes: string | null
          p_split_ratio: Json | null
          p_status: string
          p_tag_ids: string[]
        }
        Returns: {
          account_id: string
          amount: number
          category_id: string | null
          created_at: string | null
          csv_import_id: string | null
          currency: string
          date: string
          description: string
          external_id: string | null
          id: string
          import_match_hash: string | null
          is_shared: boolean | null
          kind: Database["public"]["Enums"]["transaction_kind"]
          notes: string | null
          source: string | null
          source_provider: string | null
          split_ratio: Json | null
          status: string
          updated_at: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_personal_transaction_exact: {
        Args: {
          p_transaction_id: string
          p_account_id: string
          p_kind: Database["public"]["Enums"]["transaction_kind"]
          p_amount: string
          p_date: string
          p_description: string
          p_category_id: string | null
          p_notes: string | null
          p_is_shared: boolean
          p_split_ratio: Json | null
          p_status: string
          p_tag_ids: string[]
        }
        Returns: Json
      }
      update_household_account: {
        Args: { p_account_id: string; p_name: string; p_type: string }
        Returns: Json
      }
      update_household_account_income: {
        Args: {
          p_account_id: string
          p_amount: string
          p_date: string
          p_description: string
          p_notes: string | null
          p_status: string
          p_transaction_id: string
        }
        Returns: Json
      }
      update_shared_expense: {
        Args: {
          p_amount: string
          p_category_id: string | null
          p_date: string
          p_description: string
          p_expense_id: string
          p_notes: string | null
          p_source_account_id: string
          p_split_mode: string
          p_splits: Json | null
          p_status: string
        }
        Returns: Json
      }
    }
    Enums: {
      transaction_kind: "income" | "expense"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      transaction_kind: ["income", "expense"],
    },
  },
} as const
