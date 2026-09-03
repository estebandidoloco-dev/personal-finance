export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      accounts: {
        Row: {
          balance: number;
          created_at: string | null;
          currency: string;
          id: string;
          initial_balance: number;
          institution: string | null;
          is_shared: boolean | null;
          last_synced_at: string | null;
          name: string;
          type: string;
          user_id: string;
        };
        Insert: {
          balance?: number | null;
          created_at?: string | null;
          currency?: string | null;
          id?: string;
          initial_balance?: number;
          institution?: string | null;
          is_shared?: boolean | null;
          last_synced_at?: string | null;
          name: string;
          type: string;
          user_id: string;
        };
        Update: {
          balance?: number | null;
          created_at?: string | null;
          currency?: string | null;
          id?: string;
          initial_balance?: number;
          institution?: string | null;
          is_shared?: boolean | null;
          last_synced_at?: string | null;
          name?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'accounts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      budgets: {
        Row: {
          alert_threshold: number | null;
          amount: number;
          category_id: string;
          created_at: string | null;
          id: string;
          month: string;
          user_id: string;
        };
        Insert: {
          alert_threshold?: number | null;
          amount: number;
          category_id: string;
          created_at?: string | null;
          id?: string;
          month: string;
          user_id: string;
        };
        Update: {
          alert_threshold?: number | null;
          amount?: number;
          category_id?: string;
          created_at?: string | null;
          id?: string;
          month?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budgets_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'budgets_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      categories: {
        Row: {
          budget_type: string | null;
          color: string | null;
          created_at: string | null;
          icon: string | null;
          id: string;
          is_system: boolean | null;
          name: string;
          parent_id: string | null;
          sort_order: number | null;
          type: string;
          user_id: string | null;
        };
        Insert: {
          budget_type?: string | null;
          color?: string | null;
          created_at?: string | null;
          icon?: string | null;
          id?: string;
          is_system?: boolean | null;
          name: string;
          parent_id?: string | null;
          sort_order?: number | null;
          type: string;
          user_id?: string | null;
        };
        Update: {
          budget_type?: string | null;
          color?: string | null;
          created_at?: string | null;
          icon?: string | null;
          id?: string;
          is_system?: boolean | null;
          name?: string;
          parent_id?: string | null;
          sort_order?: number | null;
          type?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'categories_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'categories_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      csv_imports: {
        Row: {
          account_id: string;
          completed_at: string | null;
          created_at: string | null;
          errors: Json | null;
          file_hash: string;
          file_name: string;
          id: string;
          metadata: Json;
          rows_duplicate: number;
          rows_failed: number;
          rows_imported: number;
          rows_invalid: number;
          rows_skipped: number;
          rows_total: number;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          completed_at?: string | null;
          created_at?: string | null;
          errors?: Json | null;
          file_hash: string;
          file_name: string;
          id?: string;
          metadata?: Json;
          rows_duplicate?: number;
          rows_failed?: number;
          rows_imported?: number;
          rows_invalid?: number;
          rows_skipped?: number;
          rows_total: number;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          completed_at?: string | null;
          created_at?: string | null;
          errors?: Json | null;
          file_hash?: string;
          file_name?: string;
          id?: string;
          metadata?: Json;
          rows_duplicate?: number;
          rows_failed?: number;
          rows_imported?: number;
          rows_invalid?: number;
          rows_skipped?: number;
          rows_total?: number;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'csv_imports_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'csv_imports_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      goals: {
        Row: {
          account_id: string | null;
          category_id: string | null;
          color: string | null;
          created_at: string | null;
          current_amount: number | null;
          icon: string | null;
          id: string;
          is_shared: boolean | null;
          name: string;
          target_amount: number;
          target_date: string | null;
          user_id: string;
        };
        Insert: {
          account_id?: string | null;
          category_id?: string | null;
          color?: string | null;
          created_at?: string | null;
          current_amount?: number | null;
          icon?: string | null;
          id?: string;
          is_shared?: boolean | null;
          name: string;
          target_amount: number;
          target_date?: string | null;
          user_id: string;
        };
        Update: {
          account_id?: string | null;
          category_id?: string | null;
          color?: string | null;
          created_at?: string | null;
          current_amount?: number | null;
          icon?: string | null;
          id?: string;
          is_shared?: boolean | null;
          name?: string;
          target_amount?: number;
          target_date?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'goals_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'goals_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'goals_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string | null;
          currency: string;
          display_name: string;
          id: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string | null;
          currency?: string | null;
          display_name: string;
          id: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string | null;
          currency?: string | null;
          display_name?: string;
          id?: string;
        };
        Relationships: [];
      };
      split_rules: {
        Row: {
          created_at: string | null;
          id: string;
          is_default: boolean | null;
          name: string;
          ratios: Json;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          is_default?: boolean | null;
          name: string;
          ratios: Json;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          is_default?: boolean | null;
          name?: string;
          ratios?: Json;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'split_rules_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      subscriptions: {
        Row: {
          account_id: string | null;
          amount: number;
          billing_cycle: string;
          category_id: string | null;
          created_at: string | null;
          currency: string | null;
          detection_confidence: number | null;
          id: string;
          last_charge_date: string | null;
          name: string;
          next_charge_date: string;
          status: string | null;
          user_id: string;
        };
        Insert: {
          account_id?: string | null;
          amount: number;
          billing_cycle: string;
          category_id?: string | null;
          created_at?: string | null;
          currency?: string | null;
          detection_confidence?: number | null;
          id?: string;
          last_charge_date?: string | null;
          name: string;
          next_charge_date: string;
          status?: string | null;
          user_id: string;
        };
        Update: {
          account_id?: string | null;
          amount?: number;
          billing_cycle?: string;
          category_id?: string | null;
          created_at?: string | null;
          currency?: string | null;
          detection_confidence?: number | null;
          id?: string;
          last_charge_date?: string | null;
          name?: string;
          next_charge_date?: string;
          status?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      tags: {
        Row: {
          color: string | null;
          id: string;
          name: string;
          user_id: string;
        };
        Insert: {
          color?: string | null;
          id?: string;
          name: string;
          user_id: string;
        };
        Update: {
          color?: string | null;
          id?: string;
          name?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tags_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      transaction_tags: {
        Row: {
          tag_id: string;
          transaction_id: string;
        };
        Insert: {
          tag_id: string;
          transaction_id: string;
        };
        Update: {
          tag_id?: string;
          transaction_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'transaction_tags_tag_id_fkey';
            columns: ['tag_id'];
            isOneToOne: false;
            referencedRelation: 'tags';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transaction_tags_transaction_id_fkey';
            columns: ['transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      transactions: {
        Row: {
          account_id: string;
          amount: number;
          category_id: string | null;
          created_at: string | null;
          currency: string | null;
          csv_import_id: string | null;
          date: string;
          description: string;
          external_id: string | null;
          id: string;
          import_match_hash: string | null;
          is_shared: boolean | null;
          kind: Database['public']['Enums']['transaction_kind'];
          notes: string | null;
          source: string | null;
          source_provider: string | null;
          split_ratio: Json | null;
          status: string;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          account_id: string;
          amount: number;
          category_id?: string | null;
          created_at?: string | null;
          currency?: string | null;
          csv_import_id?: string | null;
          date: string;
          description: string;
          external_id?: string | null;
          id?: string;
          import_match_hash?: string | null;
          is_shared?: boolean | null;
          kind: Database['public']['Enums']['transaction_kind'];
          notes?: string | null;
          source?: string | null;
          source_provider?: string | null;
          split_ratio?: Json | null;
          status?: string | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          account_id?: string;
          amount?: number;
          category_id?: string | null;
          created_at?: string | null;
          currency?: string | null;
          csv_import_id?: string | null;
          date?: string;
          description?: string;
          external_id?: string | null;
          id?: string;
          import_match_hash?: string | null;
          is_shared?: boolean | null;
          kind?: Database['public']['Enums']['transaction_kind'];
          notes?: string | null;
          source?: string | null;
          source_provider?: string | null;
          split_ratio?: Json | null;
          status?: string | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'transactions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_csv_import_id_fkey';
            columns: ['csv_import_id'];
            isOneToOne: false;
            referencedRelation: 'csv_imports';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      account_balance_reconciliation: {
        Row: {
          account_id: string | null;
          drift: number | null;
          expected_balance: number | null;
          initial_balance: number | null;
          ledger_impact: number | null;
          stored_balance: number | null;
          user_id: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      get_dashboard_summary: {
        Args: { p_period: string };
        Returns: Json;
      };
      csv_import_match_hash: {
        Args: {
          p_amount: number;
          p_date: string;
          p_description: string;
          p_kind: Database['public']['Enums']['transaction_kind'];
        };
        Returns: string;
      };
      create_financial_transaction: {
        Args: {
          p_account_id: string;
          p_amount: number;
          p_category_id?: string | null;
          p_currency: string;
          p_date: string;
          p_description: string;
          p_external_id?: string | null;
          p_is_shared?: boolean;
          p_kind: Database['public']['Enums']['transaction_kind'];
          p_notes?: string | null;
          p_source?: string;
          p_split_ratio?: Json | null;
          p_status?: string;
          p_tag_ids?: string[];
        };
        Returns: {
          account_id: string;
          amount: number;
          category_id: string | null;
          created_at: string | null;
          currency: string;
          date: string;
          description: string;
          external_id: string | null;
          id: string;
          is_shared: boolean | null;
          kind: Database['public']['Enums']['transaction_kind'];
          notes: string | null;
          source: string | null;
          split_ratio: Json | null;
          status: string;
          updated_at: string | null;
          user_id: string;
        };
      };
      delete_financial_transaction: {
        Args: { p_id: string };
        Returns: string;
      };
      import_csv_transactions_batch: {
        Args: { p_category_id: string | null; p_import_id: string; p_rows: Json };
        Returns: {
          error_code: string | null;
          error_message: string | null;
          result_status: string;
          row_number: number;
          transaction_id: string | null;
        }[];
      };
      preview_csv_import_rows: {
        Args: { p_account_id: string; p_rows: Json; p_source_provider: string };
        Returns: {
          possible_duplicate: boolean;
          row_number: number;
          strong_duplicate: boolean;
        }[];
      };
      update_financial_transaction: {
        Args: {
          p_account_id: string;
          p_amount: number;
          p_category_id: string | null;
          p_currency: string;
          p_date: string;
          p_description: string;
          p_id: string;
          p_is_shared: boolean;
          p_kind: Database['public']['Enums']['transaction_kind'];
          p_notes: string | null;
          p_split_ratio: Json | null;
          p_status: string;
          p_tag_ids: string[];
        };
        Returns: {
          account_id: string;
          amount: number;
          category_id: string | null;
          created_at: string | null;
          currency: string;
          date: string;
          description: string;
          external_id: string | null;
          id: string;
          is_shared: boolean | null;
          kind: Database['public']['Enums']['transaction_kind'];
          notes: string | null;
          source: string | null;
          split_ratio: Json | null;
          status: string;
          updated_at: string | null;
          user_id: string;
        };
      };
    };
    Enums: {
      transaction_kind: 'income' | 'expense';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      transaction_kind: ['income', 'expense'],
    },
  },
} as const;
