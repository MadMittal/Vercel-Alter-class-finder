# Masters' Union Alt-Class Finder — Vercel Standalone

High-performance, edge-cached timetable navigator and clash resolution engine for **Masters' Union Cohort 7** (Sections A–H).

---

## 🚀 Features

- **Sub-100ms Performance:** Edge-cached via Next.js ISR (Incremental Static Regeneration).
- **Zero Google Multi-Account Hurdles:** Fast, public access with clean URLs.
- **Accurate Attendance Numbering:** Cancelled classes (marked with strikethrough in Google Sheets) are automatically detected and omitted from syllabus session numbering.
- **2-Step Consumer Clash Resolver:**
  - Date & Time prominently displayed.
  - Important Rule disclaimer for quizzes & graded evaluations.
  - Recommends attending the constrained class today and catches the alternate later with Section X.
  - 1-click formatted copy for WhatsApp.

---

## 🛠️ Deploying to Vercel (100% Free)

### Step 1: Push to your GitHub
1. Create a repository on GitHub (e.g. `Vercel-Alter-class-finder`).
2. Push this folder to your repository.

### Step 2: Import into Vercel
1. Go to your [Vercel Dashboard](https://vercel.com/dashboard).
2. Click **+ Create New** -> **Project**.
3. Select your `Vercel-Alter-class-finder` repository and click **Deploy**.

### Step 3: Configure Environment Variables (Optional for Service Account)
Under **Project Settings -> Environment Variables** in Vercel:
- `GOOGLE_SERVICE_ACCOUNT_KEY`: The JSON string of your Google Cloud Service Account.
- `SOURCE_SHEET_ID`: `1esfFF_aoab5VoxNUg7IWLqYgwO-sEJUDtVIQ1k78Olk`
- `SHEET_NAME`: `C7: PreLMS T3`
