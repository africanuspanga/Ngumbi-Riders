export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      announcement_recipients: {
        Row: {
          announcement_id: string
          created_at: string
          id: string
          notification_id: string | null
          rider_id: string
        }
        Insert: {
          announcement_id: string
          created_at?: string
          id?: string
          notification_id?: string | null
          rider_id: string
        }
        Update: {
          announcement_id?: string
          created_at?: string
          id?: string
          notification_id?: string | null
          rider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_recipients_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_recipients_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_recipients_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          audience: string
          body: string
          created_at: string
          created_by: string | null
          id: string
          title: string
        }
        Insert: {
          audience?: string
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          title: string
        }
        Update: {
          audience?: string
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          brand_primary_color: string
          business_name: string
          currency: string
          daily_summary_time: string
          default_installment_amount: number
          id: boolean
          payment_deadline_time: string
          reminder_config: Json
          timezone: string
          updated_at: string
        }
        Insert: {
          brand_primary_color?: string
          business_name?: string
          currency?: string
          daily_summary_time?: string
          default_installment_amount?: number
          id?: boolean
          payment_deadline_time?: string
          reminder_config?: Json
          timezone?: string
          updated_at?: string
        }
        Update: {
          brand_primary_color?: string
          business_name?: string
          currency?: string
          daily_summary_time?: string
          default_installment_amount?: number
          id?: boolean
          payment_deadline_time?: string
          reminder_config?: Json
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      application_documents: {
        Row: {
          application_id: string
          created_at: string
          doc_type: string
          id: string
          storage_path: string
        }
        Insert: {
          application_id: string
          created_at?: string
          doc_type: string
          id?: string
          storage_path: string
        }
        Update: {
          application_id?: string
          created_at?: string
          doc_type?: string
          id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "rider_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip: string | null
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip?: string | null
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip?: string | null
          metadata?: Json
        }
        Relationships: []
      }
      contract_documents: {
        Row: {
          contract_id: string
          created_at: string
          doc_type: string
          id: string
          is_signed: boolean
          sha256_hash: string | null
          storage_path: string
          version: number
        }
        Insert: {
          contract_id: string
          created_at?: string
          doc_type?: string
          id?: string
          is_signed?: boolean
          sha256_hash?: string | null
          storage_path: string
          version?: number
        }
        Update: {
          contract_id?: string
          created_at?: string
          doc_type?: string
          id?: string
          is_signed?: boolean
          sha256_hash?: string | null
          storage_path?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "contract_documents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_events: {
        Row: {
          contract_id: string
          created_at: string
          created_by: string | null
          effective_date: string
          event_type: string
          financial_impact: Json
          id: string
          reason: string | null
        }
        Insert: {
          contract_id: string
          created_at?: string
          created_by?: string | null
          effective_date: string
          event_type: string
          financial_impact?: Json
          id?: string
          reason?: string | null
        }
        Update: {
          contract_id?: string
          created_at?: string
          created_by?: string | null
          effective_date?: string
          event_type?: string
          financial_impact?: Json
          id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_events_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_signatures: {
        Row: {
          contract_id: string
          id: string
          ip: string | null
          method: string | null
          signature_image_path: string | null
          signed_at: string
          signer_name: string | null
          signer_role: string
          user_agent: string | null
        }
        Insert: {
          contract_id: string
          id?: string
          ip?: string | null
          method?: string | null
          signature_image_path?: string | null
          signed_at?: string
          signer_name?: string | null
          signer_role: string
          user_agent?: string | null
        }
        Update: {
          contract_id?: string
          id?: string
          ip?: string | null
          method?: string | null
          signature_image_path?: string | null
          signed_at?: string
          signer_name?: string | null
          signer_role?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_signatures_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          name: string
          version: number
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          name: string
          version: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          name?: string
          version?: number
        }
        Relationships: []
      }
      contract_versions: {
        Row: {
          contract_id: string
          created_at: string
          created_by: string | null
          id: string
          reason: string | null
          snapshot: Json
          version: number
        }
        Insert: {
          contract_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          snapshot: Json
          version: number
        }
        Update: {
          contract_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "contract_versions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          assignment_id: string | null
          contract_number: string
          contract_type: string
          created_at: string
          currency: string
          current_version: number
          due_day_of_month: number | null
          duration_months: number | null
          end_date: string | null
          id: string
          installment_amount: number
          motorcycle_id: string
          ownership_transfer_notes: string | null
          ownership_transfers: boolean
          payment_deadline_time: string
          rider_id: string
          schedule_type: Database["public"]["Enums"]["schedule_type"]
          selected_weekdays: number[]
          special_terms: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["contract_status"]
          template_version: number | null
          updated_at: string
        }
        Insert: {
          assignment_id?: string | null
          contract_number: string
          contract_type?: string
          created_at?: string
          currency?: string
          current_version?: number
          due_day_of_month?: number | null
          duration_months?: number | null
          end_date?: string | null
          id?: string
          installment_amount?: number
          motorcycle_id: string
          ownership_transfer_notes?: string | null
          ownership_transfers?: boolean
          payment_deadline_time?: string
          rider_id: string
          schedule_type?: Database["public"]["Enums"]["schedule_type"]
          selected_weekdays?: number[]
          special_terms?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          template_version?: number | null
          updated_at?: string
        }
        Update: {
          assignment_id?: string | null
          contract_number?: string
          contract_type?: string
          created_at?: string
          currency?: string
          current_version?: number
          due_day_of_month?: number | null
          duration_months?: number | null
          end_date?: string | null
          id?: string
          installment_amount?: number
          motorcycle_id?: string
          ownership_transfer_notes?: string | null
          ownership_transfers?: boolean
          payment_deadline_time?: string
          rider_id?: string
          schedule_type?: Database["public"]["Enums"]["schedule_type"]
          selected_weekdays?: number[]
          special_terms?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          template_version?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "motorcycle_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_motorcycle_id_fkey"
            columns: ["motorcycle_id"]
            isOneToOne: false
            referencedRelation: "motorcycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_summaries: {
        Row: {
          created_at: string
          email_sent_at: string | null
          id: string
          idempotency_key: string
          metrics: Json
          summary_date: string
        }
        Insert: {
          created_at?: string
          email_sent_at?: string | null
          id?: string
          idempotency_key: string
          metrics?: Json
          summary_date: string
        }
        Update: {
          created_at?: string
          email_sent_at?: string | null
          id?: string
          idempotency_key?: string
          metrics?: Json
          summary_date?: string
        }
        Relationships: []
      }
      exemption_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          obligation_id: string
          postponed_to_date: string | null
          reason: string
          rider_id: string
          status: Database["public"]["Enums"]["exemption_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          obligation_id: string
          postponed_to_date?: string | null
          reason: string
          rider_id: string
          status?: Database["public"]["Enums"]["exemption_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          obligation_id?: string
          postponed_to_date?: string | null
          reason?: string
          rider_id?: string
          status?: Database["public"]["Enums"]["exemption_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exemption_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exemption_requests_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "payment_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exemption_requests_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      guarantor_documents: {
        Row: {
          created_at: string
          doc_type: string
          guarantor_id: string
          id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          doc_type: string
          guarantor_id: string
          id?: string
          storage_path: string
        }
        Update: {
          created_at?: string
          doc_type?: string
          guarantor_id?: string
          id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "guarantor_documents_guarantor_id_fkey"
            columns: ["guarantor_id"]
            isOneToOne: false
            referencedRelation: "guarantors"
            referencedColumns: ["id"]
          },
        ]
      }
      guarantors: {
        Row: {
          application_id: string | null
          created_at: string
          employer: string | null
          full_name: string
          id: string
          nida_number_encrypted: string | null
          occupation: string | null
          phone: string
          relationship: string | null
          residential_address: string | null
          rider_id: string | null
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          employer?: string | null
          full_name: string
          id?: string
          nida_number_encrypted?: string | null
          occupation?: string | null
          phone: string
          relationship?: string | null
          residential_address?: string | null
          rider_id?: string | null
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          created_at?: string
          employer?: string | null
          full_name?: string
          id?: string
          nida_number_encrypted?: string | null
          occupation?: string | null
          phone?: string
          relationship?: string | null
          residential_address?: string | null
          rider_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guarantors_application_fk"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "rider_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guarantors_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          file_path: string | null
          id: string
          import_type: string
          status: string
          summary: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          id?: string
          import_type: string
          status?: string
          summary?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          id?: string
          import_type?: string
          status?: string
          summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rows: {
        Row: {
          batch_id: string
          created_at: string
          errors: Json
          id: string
          raw: Json
          row_number: number
          status: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          errors?: Json
          id?: string
          raw: Json
          row_number: number
          status?: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          errors?: Json
          id?: string
          raw?: Json
          row_number?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_reports: {
        Row: {
          category: Database["public"]["Enums"]["incident_category"]
          created_at: string
          description: string
          id: string
          location_text: string | null
          occurred_at: string
          rider_id: string
          status: string
          updated_at: string
        }
        Insert: {
          category: Database["public"]["Enums"]["incident_category"]
          created_at?: string
          description: string
          id?: string
          location_text?: string | null
          occurred_at: string
          rider_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["incident_category"]
          created_at?: string
          description?: string
          id?: string
          location_text?: string | null
          occurred_at?: string
          rider_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_reports_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          created_at: string
          id: string
          ip: string
          outcome: Database["public"]["Enums"]["login_outcome"]
          phone: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip: string
          outcome: Database["public"]["Enums"]["login_outcome"]
          phone?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string
          outcome?: Database["public"]["Enums"]["login_outcome"]
          phone?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      message_outbox: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          id: string
          last_error: string | null
          payload: Json
          recipient: string
          status: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          channel: string
          created_at?: string
          id?: string
          last_error?: string | null
          payload?: Json
          recipient: string
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          id?: string
          last_error?: string | null
          payload?: Json
          recipient?: string
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      motorcycle_assignments: {
        Row: {
          created_at: string
          end_date: string | null
          id: string
          is_active: boolean
          motorcycle_id: string
          rider_id: string
          start_date: string
          transfer_reason: string | null
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          motorcycle_id: string
          rider_id: string
          start_date: string
          transfer_reason?: string | null
        }
        Update: {
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          motorcycle_id?: string
          rider_id?: string
          start_date?: string
          transfer_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "motorcycle_assignments_motorcycle_id_fkey"
            columns: ["motorcycle_id"]
            isOneToOne: false
            referencedRelation: "motorcycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "motorcycle_assignments_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      motorcycle_expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string | null
          expense_date: string
          id: string
          motorcycle_id: string
          note: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by?: string | null
          expense_date: string
          id?: string
          motorcycle_id: string
          note?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          expense_date?: string
          id?: string
          motorcycle_id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "motorcycle_expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "motorcycle_expenses_motorcycle_id_fkey"
            columns: ["motorcycle_id"]
            isOneToOne: false
            referencedRelation: "motorcycles"
            referencedColumns: ["id"]
          },
        ]
      }
      motorcycles: {
        Row: {
          chassis_number: string | null
          colour: string | null
          created_at: string
          district: string | null
          engine_number: string | null
          id: string
          make: string | null
          model: string | null
          motorcycle_number: string
          region: string | null
          registration_number: string | null
          status: Database["public"]["Enums"]["motorcycle_status"]
          updated_at: string
        }
        Insert: {
          chassis_number?: string | null
          colour?: string | null
          created_at?: string
          district?: string | null
          engine_number?: string | null
          id?: string
          make?: string | null
          model?: string | null
          motorcycle_number: string
          region?: string | null
          registration_number?: string | null
          status?: Database["public"]["Enums"]["motorcycle_status"]
          updated_at?: string
        }
        Update: {
          chassis_number?: string | null
          colour?: string | null
          created_at?: string
          district?: string | null
          engine_number?: string | null
          id?: string
          make?: string | null
          model?: string | null
          motorcycle_number?: string
          region?: string | null
          registration_number?: string | null
          status?: Database["public"]["Enums"]["motorcycle_status"]
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          dedupe_key: string | null
          deep_link: string | null
          id: string
          read_at: string | null
          recipient_profile_id: string
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          deep_link?: string | null
          id?: string
          read_at?: string | null
          recipient_profile_id: string
          title: string
          type: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          deep_link?: string | null
          id?: string
          read_at?: string | null
          recipient_profile_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_allocations: {
        Row: {
          amount: number
          created_at: string
          id: string
          obligation_id: string
          payment_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          obligation_id: string
          payment_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          obligation_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "payment_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          event_type: string
          id: string
          payload_hash: string | null
          payment_id: string | null
          provider_event_id: string | null
          raw_payload: Json
          received_at: string
        }
        Insert: {
          event_type: string
          id?: string
          payload_hash?: string | null
          payment_id?: string | null
          provider_event_id?: string | null
          raw_payload?: Json
          received_at?: string
        }
        Update: {
          event_type?: string
          id?: string
          payload_hash?: string | null
          payment_id?: string | null
          provider_event_id?: string | null
          raw_payload?: Json
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_obligations: {
        Row: {
          amount_due: number
          contract_id: string
          contract_version: number
          created_at: string
          due_at: string
          due_date: string
          exemption_id: string | null
          id: string
          local_due_time: string
          motorcycle_id: string
          paid_in_advance_at: string | null
          rider_id: string
          settled_at: string | null
          status: Database["public"]["Enums"]["obligation_status"]
          updated_at: string
        }
        Insert: {
          amount_due: number
          contract_id: string
          contract_version?: number
          created_at?: string
          due_at: string
          due_date: string
          exemption_id?: string | null
          id?: string
          local_due_time: string
          motorcycle_id: string
          paid_in_advance_at?: string | null
          rider_id: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["obligation_status"]
          updated_at?: string
        }
        Update: {
          amount_due?: number
          contract_id?: string
          contract_version?: number
          created_at?: string
          due_at?: string
          due_date?: string
          exemption_id?: string | null
          id?: string
          local_due_time?: string
          motorcycle_id?: string
          paid_in_advance_at?: string | null
          rider_id?: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["obligation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "obligations_exemption_fk"
            columns: ["exemption_id"]
            isOneToOne: false
            referencedRelation: "exemption_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_obligations_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_obligations_motorcycle_id_fkey"
            columns: ["motorcycle_id"]
            isOneToOne: false
            referencedRelation: "motorcycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_obligations_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reservations: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          is_active: boolean
          obligation_id: string
          payment_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          is_active?: boolean
          obligation_id: string
          payment_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          is_active?: boolean
          obligation_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reservations_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "payment_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reservations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          completed_at: string | null
          contract_id: string
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          method: Database["public"]["Enums"]["payment_method"]
          payer_phone: string | null
          provider_payment_id: string | null
          rider_id: string
          snippe_reference: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          completed_at?: string | null
          contract_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          method: Database["public"]["Enums"]["payment_method"]
          payer_phone?: string | null
          provider_payment_id?: string | null
          rider_id: string
          snippe_reference?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          completed_at?: string | null
          contract_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          method?: Database["public"]["Enums"]["payment_method"]
          payer_phone?: string | null
          provider_payment_id?: string | null
          rider_id?: string
          snippe_reference?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          must_change_pin: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          must_change_pin?: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          must_change_pin?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          profile_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          profile_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_events: {
        Row: {
          action: string
          created_at: string
          id: string
          subject: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          subject: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          subject?: string
        }
        Relationships: []
      }
      receipts: {
        Row: {
          created_at: string
          id: string
          payment_id: string
          receipt_number: string
          storage_path: string | null
          verification_code: string
        }
        Insert: {
          created_at?: string
          id?: string
          payment_id: string
          receipt_number: string
          storage_path?: string | null
          verification_code: string
        }
        Update: {
          created_at?: string
          id?: string
          payment_id?: string
          receipt_number?: string
          storage_path?: string | null
          verification_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_applications: {
        Row: {
          alternative_phone: string | null
          converted_rider_id: string | null
          created_at: string
          date_of_birth: string | null
          district: string | null
          driving_licence_encrypted: string | null
          duplicate_flags: Json
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          first_name: string
          full_address: string | null
          gender: string | null
          id: string
          identity_type: Database["public"]["Enums"]["identity_type"] | null
          last_name: string
          middle_name: string | null
          nida_number_encrypted: string | null
          previous_experience: string | null
          primary_phone: string
          reference: string
          region: string | null
          resume_token_hash: string | null
          status: Database["public"]["Enums"]["application_status"]
          street: string | null
          submitted_at: string | null
          updated_at: string
          voter_id_encrypted: string | null
          ward: string | null
        }
        Insert: {
          alternative_phone?: string | null
          converted_rider_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          district?: string | null
          driving_licence_encrypted?: string | null
          duplicate_flags?: Json
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          first_name: string
          full_address?: string | null
          gender?: string | null
          id?: string
          identity_type?: Database["public"]["Enums"]["identity_type"] | null
          last_name: string
          middle_name?: string | null
          nida_number_encrypted?: string | null
          previous_experience?: string | null
          primary_phone: string
          reference: string
          region?: string | null
          resume_token_hash?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          street?: string | null
          submitted_at?: string | null
          updated_at?: string
          voter_id_encrypted?: string | null
          ward?: string | null
        }
        Update: {
          alternative_phone?: string | null
          converted_rider_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          district?: string | null
          driving_licence_encrypted?: string | null
          duplicate_flags?: Json
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          first_name?: string
          full_address?: string | null
          gender?: string | null
          id?: string
          identity_type?: Database["public"]["Enums"]["identity_type"] | null
          last_name?: string
          middle_name?: string | null
          nida_number_encrypted?: string | null
          previous_experience?: string | null
          primary_phone?: string
          reference?: string
          region?: string | null
          resume_token_hash?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          street?: string | null
          submitted_at?: string | null
          updated_at?: string
          voter_id_encrypted?: string | null
          ward?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rider_applications_converted_rider_id_fkey"
            columns: ["converted_rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_documents: {
        Row: {
          created_at: string
          doc_type: string
          id: string
          rider_id: string
          rider_viewable: boolean
          storage_path: string
        }
        Insert: {
          created_at?: string
          doc_type: string
          id?: string
          rider_id: string
          rider_viewable?: boolean
          storage_path: string
        }
        Update: {
          created_at?: string
          doc_type?: string
          id?: string
          rider_id?: string
          rider_viewable?: boolean
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_documents_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_private_data: {
        Row: {
          driving_licence_encrypted: string | null
          encryption_key_version: number
          identity_type: Database["public"]["Enums"]["identity_type"] | null
          nida_number_encrypted: string | null
          owner_notes: string | null
          rider_id: string
          updated_at: string
          voter_id_encrypted: string | null
        }
        Insert: {
          driving_licence_encrypted?: string | null
          encryption_key_version?: number
          identity_type?: Database["public"]["Enums"]["identity_type"] | null
          nida_number_encrypted?: string | null
          owner_notes?: string | null
          rider_id: string
          updated_at?: string
          voter_id_encrypted?: string | null
        }
        Update: {
          driving_licence_encrypted?: string | null
          encryption_key_version?: number
          identity_type?: Database["public"]["Enums"]["identity_type"] | null
          nida_number_encrypted?: string | null
          owner_notes?: string | null
          rider_id?: string
          updated_at?: string
          voter_id_encrypted?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rider_private_data_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: true
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      riders: {
        Row: {
          created_at: string
          date_of_birth: string | null
          district: string | null
          email: string | null
          first_name: string
          full_address: string | null
          gender: string | null
          id: string
          last_name: string
          middle_name: string | null
          phone: string
          profile_id: string
          region: string | null
          rider_number: string
          risk_level: Database["public"]["Enums"]["risk_level"]
          risk_reasons: Json
          status: Database["public"]["Enums"]["rider_status"]
          street: string | null
          updated_at: string
          ward: string | null
        }
        Insert: {
          created_at?: string
          date_of_birth?: string | null
          district?: string | null
          email?: string | null
          first_name: string
          full_address?: string | null
          gender?: string | null
          id?: string
          last_name: string
          middle_name?: string | null
          phone: string
          profile_id: string
          region?: string | null
          rider_number: string
          risk_level?: Database["public"]["Enums"]["risk_level"]
          risk_reasons?: Json
          status?: Database["public"]["Enums"]["rider_status"]
          street?: string | null
          updated_at?: string
          ward?: string | null
        }
        Update: {
          created_at?: string
          date_of_birth?: string | null
          district?: string | null
          email?: string | null
          first_name?: string
          full_address?: string | null
          gender?: string | null
          id?: string
          last_name?: string
          middle_name?: string | null
          phone?: string
          profile_id?: string
          region?: string | null
          rider_number?: string
          risk_level?: Database["public"]["Enums"]["risk_level"]
          risk_reasons?: Json
          status?: Database["public"]["Enums"]["rider_status"]
          street?: string | null
          updated_at?: string
          ward?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "riders_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_snapshots: {
        Row: {
          computed_at: string
          id: string
          level: Database["public"]["Enums"]["risk_level"]
          reasons: Json
          rider_id: string
        }
        Insert: {
          computed_at?: string
          id?: string
          level: Database["public"]["Enums"]["risk_level"]
          reasons?: Json
          rider_id: string
        }
        Update: {
          computed_at?: string
          id?: string
          level?: Database["public"]["Enums"]["risk_level"]
          reasons?: Json
          rider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_snapshots_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      system_job_runs: {
        Row: {
          completed_at: string | null
          counts: Json
          error_summary: string | null
          id: string
          job_name: string
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          counts?: Json
          error_summary?: string | null
          id?: string
          job_name: string
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          counts?: Json
          error_summary?: string | null
          id?: string
          job_name?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_contract_and_generate_obligations: {
        Args: { p_contract_id: string; p_obligations: Json }
        Returns: number
      }
      apply_exemption_waiver: {
        Args: { p_exemption_id: string }
        Returns: undefined
      }
      apply_postponement: {
        Args: {
          p_due_at: string
          p_exemption_id: string
          p_local_due_time: string
          p_new_date: string
        }
        Returns: string
      }
      current_rider_id: { Args: never; Returns: string }
      is_owner: { Args: never; Returns: boolean }
      record_completed_payment: {
        Args: {
          p_completed_at: string
          p_obligation_ids: string[]
          p_payment_id: string
          p_receipt_number: string
        }
        Returns: undefined
      }
    }
    Enums: {
      application_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "interview"
        | "verification"
        | "approved"
        | "rejected"
        | "waitlisted"
        | "withdrawn"
        | "converted_to_rider"
      contract_status:
        | "draft"
        | "awaiting_signatures"
        | "scheduled"
        | "active"
        | "paused"
        | "completed"
        | "completed_early"
        | "terminated"
        | "cancelled"
      exemption_status:
        | "submitted"
        | "under_review"
        | "approved_waived"
        | "approved_postponed"
        | "rejected"
        | "cancelled"
      identity_type: "nida" | "driving_licence" | "voter_id"
      incident_category:
        | "breakdown"
        | "accident"
        | "theft"
        | "police_issue"
        | "maintenance_request"
        | "personal_emergency"
      login_outcome:
        | "success"
        | "invalid_credentials"
        | "weak_pin"
        | "locked"
        | "rate_limited"
        | "unknown_phone"
      motorcycle_status: "available" | "assigned" | "inactive"
      obligation_status:
        | "scheduled"
        | "due"
        | "overdue"
        | "paid"
        | "paid_in_advance"
        | "exempted"
        | "postponed"
        | "cancelled"
      payment_method: "mobile_money" | "cash"
      payment_status:
        | "created"
        | "pending"
        | "completed"
        | "failed"
        | "expired"
        | "cancelled"
        | "reversed"
      rider_status:
        | "onboarding"
        | "active"
        | "suspended"
        | "terminated"
        | "inactive"
      risk_level: "low" | "medium" | "high" | "critical"
      schedule_type: "daily" | "selected_weekdays" | "weekly" | "monthly"
      user_role: "owner" | "rider"
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
  public: {
    Enums: {
      application_status: [
        "draft",
        "submitted",
        "under_review",
        "interview",
        "verification",
        "approved",
        "rejected",
        "waitlisted",
        "withdrawn",
        "converted_to_rider",
      ],
      contract_status: [
        "draft",
        "awaiting_signatures",
        "scheduled",
        "active",
        "paused",
        "completed",
        "completed_early",
        "terminated",
        "cancelled",
      ],
      exemption_status: [
        "submitted",
        "under_review",
        "approved_waived",
        "approved_postponed",
        "rejected",
        "cancelled",
      ],
      identity_type: ["nida", "driving_licence", "voter_id"],
      incident_category: [
        "breakdown",
        "accident",
        "theft",
        "police_issue",
        "maintenance_request",
        "personal_emergency",
      ],
      login_outcome: [
        "success",
        "invalid_credentials",
        "weak_pin",
        "locked",
        "rate_limited",
        "unknown_phone",
      ],
      motorcycle_status: ["available", "assigned", "inactive"],
      obligation_status: [
        "scheduled",
        "due",
        "overdue",
        "paid",
        "paid_in_advance",
        "exempted",
        "postponed",
        "cancelled",
      ],
      payment_method: ["mobile_money", "cash"],
      payment_status: [
        "created",
        "pending",
        "completed",
        "failed",
        "expired",
        "cancelled",
        "reversed",
      ],
      rider_status: [
        "onboarding",
        "active",
        "suspended",
        "terminated",
        "inactive",
      ],
      risk_level: ["low", "medium", "high", "critical"],
      schedule_type: ["daily", "selected_weekdays", "weekly", "monthly"],
      user_role: ["owner", "rider"],
    },
  },
} as const
