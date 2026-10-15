# doddl AI Operating System — Technical Architecture

**Status:** Living document  
**Version:** 0.1 — shell  
**Last updated:** 2026-05-06  
**Owner:** Jon Fawcett (jon@doddl.com)  
**Audience:** External technical stakeholders, integration partners, security reviewers  
**Cross-reference:** [Configuration Playbook](./CONFIGURATION_PLAYBOOK.md)

---

> This document describes the technical architecture of the doddl AI Operating System end to end.
> It is version-controlled in GitHub (`D0DDL/doddl-pm`, `docs/` directory) and updated as the
> system evolves. Section content is added phase by phase; sections marked *[to be completed]*
> contain headers and structural intent only.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architectural Principles](#2-architectural-principles)
3. [Infrastructure](#3-infrastructure)
4. [Security & Credential Management](#4-security--credential-management)
5. [Data Architecture](#5-data-architecture)
6. [Connector Layer](#6-connector-layer)
7. [Scheduling & Job Management](#7-scheduling--job-management)
8. [PM Layer & Task Orchestration](#8-pm-layer--task-orchestration)
9. [Intelligence Layer](#9-intelligence-layer)
10. [Specialist Agents](#10-specialist-agents)
11. [Creative AI Stack](#11-creative-ai-stack)
12. [Compliance & Data Governance](#12-compliance--data-governance)
13. [Observability & Monitoring](#13-observability--monitoring)
14. [Deployment & Release Process](#14-deployment--release-process)
15. [Disaster Recovery & Business Continuity](#15-disaster-recovery--business-continuity)
16. [Integrations](#16-integrations)
17. [Glossary](#17-glossary)

---

## 1. System Overview

### 1.1 Purpose

### 1.2 High-Level Architecture Diagram

*[to be completed — Phase 0]*

### 1.3 System Boundaries

### 1.4 Key Design Decisions

---

## 2. Architectural Principles

### 2.1 Immutability by Default

### 2.2 Zero Credentials in Code

### 2.3 Separation of Raw and Clean Data

### 2.4 Agent-Readable PM State

### 2.5 Append-Only Compliance Logs

---

## 3. Infrastructure

### 3.1 Cloud Provider

### 3.2 Infrastructure as Code

#### 3.2.1 Terraform Structure
*Reference: [`infra/terraform/`](../infra/terraform/)*

#### 3.2.2 State Management

#### 3.2.3 Environment Separation (Staging / Production)

### 3.3 Hosting

#### 3.3.1 PM Tool — Vercel

#### 3.3.2 Connector Runtime

#### 3.3.3 Scheduling Service

### 3.4 Networking

#### 3.4.1 Private Endpoints

#### 3.4.2 Ingress / Egress Rules

---

## 4. Security & Credential Management

### 4.1 Azure Key Vault

#### 4.1.1 Vault Topology (Staging / Production)
*Reference: [`infra/terraform/modules/keyvault/`](../infra/terraform/modules/keyvault/)*

#### 4.1.2 Secret Naming Convention
*Reference: [`infra/terraform/KEYVAULT_SECRETS_REGISTRY.md`](../infra/terraform/KEYVAULT_SECRETS_REGISTRY.md)*

#### 4.1.3 Rotation Policy

#### 4.1.4 Access Policies — Connector Service Principal vs Admin

### 4.2 Authentication

#### 4.2.1 PM Tool — Microsoft MSAL (Azure AD)

#### 4.2.2 Agent API — Service Key

#### 4.2.3 Supabase Vault for In-Database Secrets

### 4.3 Data Encryption

#### 4.3.1 Encryption at Rest

#### 4.3.2 Encryption in Transit

### 4.4 Audit Logging

---

## 5. Data Architecture

### 5.1 Raw Layer

*Reference: [`lib/migrations/08-ai-os-raw-clean-schema.sql`](../lib/migrations/08-ai-os-raw-clean-schema.sql)*

#### 5.1.1 `api_raw` Table — Design Constraints

#### 5.1.2 Append-Only Guarantee

#### 5.1.3 Pull ID and Lineage

### 5.2 Clean Layer

#### 5.2.1 `api_clean` Table — Upsert Pattern

#### 5.2.2 Normalisation Rules per Source

### 5.3 Archival

#### 5.3.1 24-Month Retention in Hot Storage

#### 5.3.2 Cold Storage Archival Job (Monthly)

### 5.4 PM Tool Schema

#### 5.4.1 projects / task_groups / tasks

#### 5.4.2 Artefact Model

#### 5.4.3 Approval Workflow State Machine

### 5.5 Database Platform

#### 5.5.1 Supabase (PostgreSQL)

#### 5.5.2 Row-Level Security

#### 5.5.3 Migration Ledger (`schema_migrations`)

---

## 6. Connector Layer

### 6.1 Purpose and Scope

### 6.2 Connector Contract

#### 6.2.1 Input: Key Vault Credential Fetch

#### 6.2.2 Output: api_raw INSERT + api_clean UPSERT

### 6.3 Connector Implementations

#### 6.3.1 Klaviyo

#### 6.3.2 Shopify

#### 6.3.3 Amazon SP-API

#### 6.3.4 Microsoft Graph (SharePoint / OneDrive)

#### 6.3.5 Zoho CRM

### 6.4 Error Handling and Retry Strategy

### 6.5 B2B Scraper — Compliance Constraints

---

## 7. Scheduling & Job Management

### 7.1 APScheduler

*Reference: [`connectors/scheduler/scheduler.py`](../connectors/scheduler/scheduler.py)*

#### 7.1.1 Job Store — SQLAlchemy (PostgreSQL)

#### 7.1.2 Queue-Based Execution (not cron)

#### 7.1.3 Missed Run Recovery — `misfire_grace_time` and `coalesce`

#### 7.1.4 Job Registration and Schedule Configuration

### 7.2 Supabase pg_cron Jobs

#### 7.2.1 Raw Data Archival (monthly)

#### 7.2.2 Breach Alert Queue Processor (every 5 minutes)

---

## 8. PM Layer & Task Orchestration

### 8.1 PM Tool Overview

### 8.2 Agent API

#### 8.2.1 `POST /api/agent/tasks`

#### 8.2.2 `POST /api/agent/artefacts`

#### 8.2.3 Authentication and Rate Limiting

### 8.3 Task Types

#### 8.3.1 Standard

#### 8.3.2 Approval

#### 8.3.3 Go-Live Gate

#### 8.3.4 Incident

### 8.4 Artefact Model

### 8.5 Approval Workflow

### 8.6 Agent Audit Log

---

## 9. Intelligence Layer

*[to be completed — Phase 2]*

### 9.1 Model Selection

### 9.2 Prompt Architecture

### 9.3 Context Injection — PM State and Clean Data

### 9.4 Output Routing

---

## 10. Specialist Agents

*[to be completed — Phase 3]*

### 10.1 Agent Taxonomy

### 10.2 Agent Handoff Protocol

### 10.3 Human-in-the-Loop Gates

---

## 11. Creative AI Stack

*[to be completed — Phase 4]*

---

## 12. Compliance & Data Governance

### 12.1 GDPR Framework

#### 12.1.1 Legal Basis for Processing

#### 12.1.2 Data Subject Rights

#### 12.1.3 Data Processing Agreements (DPAs)

### 12.2 Breach Logging

*Reference: [`lib/migrations/09-breach-log.sql`](../lib/migrations/09-breach-log.sql)*

#### 12.2.1 `breach_log` Table Schema

#### 12.2.2 Immutability Guarantee

#### 12.2.3 Write Access — DPO Lead Only

### 12.3 72-Hour ICO Notification Process

*Reference: [`lib/migrations/10-breach-alert-trigger.sql`](../lib/migrations/10-breach-alert-trigger.sql)*

#### 12.3.1 Automated Alert on Breach Record Creation

#### 12.3.2 48-Hour Reminder

#### 12.3.3 Manual ICO Notification Steps

### 12.4 Data Retention

### 12.5 Cookies and Consent

---

## 13. Observability & Monitoring

### 13.1 Application Logs

### 13.2 Azure Monitor — Key Vault Audit Events

### 13.3 Connector Health Dashboard

### 13.4 Scheduler Job Monitoring

### 13.5 Alerts and Escalation

---

## 14. Deployment & Release Process

### 14.1 Branching Strategy

#### 14.1.1 `staging` — Integration Environment

#### 14.1.2 `main` — Production

#### 14.1.3 Merge Policy

### 14.2 CI/CD

#### 14.2.1 Vercel Build Pipeline

#### 14.2.2 Database Migration Pipeline

### 14.3 Go-Live Gate Process

### 14.4 Rollback Procedure

---

## 15. Disaster Recovery & Business Continuity

### 15.1 RTO and RPO Targets

### 15.2 Database Backup and Point-in-Time Recovery

### 15.3 Key Vault Soft Delete and Purge Protection

### 15.4 Runbook — Connector Service Failure

### 15.5 Runbook — PM Tool Unavailability

---

## 16. Integrations

### 16.1 Klaviyo

### 16.2 Shopify

### 16.3 Amazon Seller Central (SP-API)

### 16.4 Microsoft 365 (Graph API)

### 16.5 Zoho CRM

### 16.6 Anthropic Claude API

### 16.7 Vercel

---

## 17. Glossary

| Term | Definition |
|------|-----------|
| api_raw | Append-only table storing every API response exactly as received |
| api_clean | Upserted, normalised, query-ready table — one row per source record |
| Connector | A scheduled Python module that fetches data from one external API |
| Pull ID | UUID identifying all raw records produced by one scheduler run |
| DPO | Data Protection Officer |
| misfire_grace_time | APScheduler window within which a missed job is fired on resume |
| PM Layer | The doddl-pm tool — task and project state visible to agents and humans |
| Vault | Supabase Vault (pgsodium-encrypted in-database secrets) or Azure Key Vault |

---

*This document is maintained in `docs/TECHNICAL_ARCHITECTURE.md` in `D0DDL/doddl-pm`.
For configuration values and operational runbooks, see the [Configuration Playbook](./CONFIGURATION_PLAYBOOK.md).*
