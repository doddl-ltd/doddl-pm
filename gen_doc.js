const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, LevelFormat, BorderStyle
} = require("docx");
const fs = require("fs");

const bullet = (text) => new Paragraph({
  numbering: { reference: "bullets", level: 0 },
  children: [new TextRun({ text, size: 22, font: "Arial" })]
});

const body = (text) => new Paragraph({
  spacing: { after: 120 },
  children: [new TextRun({ text, size: 22, font: "Arial" })]
});

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 300, after: 120 },
  children: [new TextRun({ text, bold: true, size: 28, font: "Arial", color: "1F497D" })]
});

const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 200, after: 80 },
  children: [new TextRun({ text, bold: true, size: 24, font: "Arial", color: "2E75B6" })]
});

const step = (label, text) => new Paragraph({
  spacing: { after: 100 },
  children: [
    new TextRun({ text: label + " ", bold: true, size: 22, font: "Arial" }),
    new TextRun({ text, size: 22, font: "Arial" })
  ]
});

const doc = new Document({
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "•",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } }
      }]
    }]
  },
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } }
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    children: [
      // Title block
      new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: "doddl AI OS", bold: true, size: 48, font: "Arial", color: "1F497D" })]
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: "Internal Data Connector — Design Documentation", size: 28, font: "Arial", color: "444444" })]
      }),
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "2E75B6", space: 1 } },
        spacing: { after: 300 },
        children: [new TextRun({ text: "Prepared for: Google Ads API Basic Access Application  |  doddl Ltd  |  May 2026", size: 18, font: "Arial", color: "888888" })]
      }),

      // Section 1
      h1("1. Overview"),
      body("doddl AI OS is a private, internal business intelligence platform built by doddl Ltd (doddl.com) to consolidate marketing and sales performance data from multiple channels into a single data store. The platform is used exclusively by the doddl internal team to monitor campaign performance, analyse return on ad spend, and inform budgeting decisions."),
      body("This document describes the design of the Google Ads API connector within that platform, submitted in support of a Basic Access developer token application."),

      // Section 2
      h1("2. Purpose of Google Ads API Integration"),
      body("The Google Ads API integration is a read-only data connector that pulls campaign, ad group, and performance metrics from doddl's own Google Ads account into an internal PostgreSQL database. No data is shared externally, resold, or used to build third-party products. The sole purpose is to give doddl's internal team a unified view of advertising performance alongside data from other channels (Meta Ads, Klaviyo, Shopify, Amazon)."),

      // Section 3
      h1("3. Data Flow"),
      h2("Authentication"),
      step("Step 1 —", "The connector uses OAuth 2.0 with a long-lived refresh token to obtain a short-lived access token from Google's authorisation servers on each scheduled run. Credentials are stored in Azure Key Vault and never in code or version control."),
      h2("Data Retrieval"),
      step("Step 2 —", "The connector calls the Google Ads API (via the google-ads Python library v24.1.0) to retrieve campaigns, ad groups, and performance metrics for doddl's own ad account (Customer ID: 9118142247, under MCC 9830339735)."),
      h2("Storage"),
      step("Step 3 —", "Retrieved data is written to two internal tables: api_raw (full JSON response archive for auditability) and api_clean (normalised records, one row per campaign/ad group/metric period)."),
      h2("Scheduling"),
      step("Step 4 —", "The connector runs once per day via APScheduler, pulling only records updated since the last successful run (incremental sync). On first run, it pulls 90 days of history."),

      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: "Data Flow Diagram", italics: true, size: 20, font: "Arial", color: "666666" })]
      }),
      new Paragraph({
        border: {
          top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
        },
        spacing: { before: 80, after: 80 },
        shading: { fill: "F5F8FB" },
        indent: { left: 360, right: 360 },
        children: [new TextRun({ text: "APScheduler  →  Google Ads API (read-only)  →  Python connector  →  Azure Key Vault (auth)  →  Supabase PostgreSQL (api_raw + api_clean)", size: 20, font: "Courier New", color: "333333" })]
      }),

      // Section 4
      h1("4. API Usage"),
      bullet("API calls are read-only (GET requests only via GAQL queries)"),
      bullet("Data pulled: campaigns, ad groups, performance metrics (impressions, clicks, spend, conversions, ROAS)"),
      bullet("Frequency: once per day (scheduled overnight)"),
      bullet("Volume: low — fewer than 500 API calls per day"),
      bullet("No write, mutate, or create operations are performed against any Google Ads account"),
      bullet("Only doddl's own account data is accessed — no other advertisers"),

      // Section 5
      h1("5. Access and Security"),
      bullet("All credentials (OAuth client ID, client secret, refresh token, developer token) stored in Azure Key Vault"),
      bullet("Credentials are never stored in code, configuration files, or version control"),
      bullet("Access to the platform is restricted to doddl internal team members only"),
      bullet("No customer PII or personally identifiable information is retrieved or stored"),
      bullet("The platform has no public-facing interface — it is entirely internal"),
      bullet("Secrets are fetched at runtime and held only in memory for the duration of each connector run"),

      // Section 6
      h1("6. Technical Stack"),
      bullet("Language: Python 3.12"),
      bullet("Google Ads library: google-ads 24.1.0"),
      bullet("Scheduler: APScheduler"),
      bullet("Database: Supabase (PostgreSQL), accessed via REST API"),
      bullet("Credential store: Azure Key Vault"),
      bullet("Hosting: Internal / Azure (Windows)"),
      bullet("Version control: GitHub (private repository, D0DDL organisation)"),

      // Section 7
      h1("7. Company Details"),
      bullet("Company: doddl Ltd"),
      bullet("Website: https://doddl.com"),
      bullet("API contact: jon@doddl.com"),
      bullet("Company type: Advertiser (direct-to-consumer e-commerce)"),
      bullet("Use: Internal business intelligence — own account data only"),
      bullet("Principal place of business: United Kingdom"),

      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 2, color: "2E75B6", space: 1 } },
        spacing: { before: 400, after: 80 },
        children: [new TextRun({ text: "This document is confidential and prepared solely for submission to Google as part of the Google Ads API Basic Access application process.", size: 18, font: "Arial", color: "888888", italics: true })]
      }),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("C:\\Users\\JonFawcett\\Documents\\doddl-pm\\doddl_ai_os_design_doc.docx", buffer);
  console.log("Document created successfully.");
});
