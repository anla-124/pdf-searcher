# PDF Searcher

A web application for processing PDF documents and performing similarity searches.

## Tech Stack

- **Framework:** [Next.js](https://nextjs.org/)
- **Language:** [TypeScript](https://www.typescriptlang.org/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Authentication:** [Supabase](https://supabase.io/)
- **Vector Search:** [Pinecone](https://www.pinecone.io/)
- **Document Processing:** [Google Cloud Document AI](https://cloud.google.com/document-ai)
- **PDF Handling:** [pdf-lib](https://pdf-lib.js.org/)
- **Linting:** [ESLint](https://eslint.org/)
- **Testing:** [Vitest](https://vitest.dev/), [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- Supabase Project
- Google Cloud Project with Document AI and Vertex AI APIs enabled
- Pinecone Account

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/anla-124/pdf-searcher.git
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Set up your environment variables by copying the appropriate template:

    **For Local Development (with local Supabase, bypasses VPN issues):**
    ```bash
    cp .env.dev.template .env.local
    # Start local Supabase: npx supabase start
    # Copy credentials from terminal output to .env.local
    ```

    **For Production Deployment (with managed Supabase):**
    ```bash
    # For free tier plans
    cp .env.free.template .env.local

    # For paid tier plans (higher performance limits)
    cp .env.paid.template .env.local
    ```

4.  Fill in the required environment variables in `.env.local`.
5.  When uploading documents, populate the metadata card for each file (law firm, fund manager, fund admin, jurisdiction).  
    - Use the **Subscription Agreement Pages to Skip** inputs if you need to exclude a page range (e.g., 12–24).  
    - Toggle **N/A** when there is no subscription agreement section; this keeps the full document.
6.  Set up the database by running the `MASTER-DATABASE-SETUP.sql` script in your Supabase SQL Editor.

### Upload Workflow

1. **Add files:** drag-and-drop or browse for PDFs (10 max per batch, 50&nbsp;MB each). Non-PDF files are rejected up front.  
2. **Validation:** every file runs through basic checks (page count, size, metadata completeness). Failed validations are flagged before upload.  
3. **Metadata form:** fill in law firm, fund manager, fund admin, jurisdiction, and optionally provide a subscription agreement skip range. When the range is supplied, those pages are removed before chunking; choosing “N/A” skips the exclusion.  
4. **Upload:** press “Upload” to send the files. The UI shows progress, and each file transitions through `pending → uploading → processing → completed/error`.  
5. **Storage & records:** every PDF is stored in Supabase Storage; a corresponding record is created in the `documents` table with the metadata payload.  
6. **Processing jobs:** each document queues a processing job unless the pipeline can start immediately (tiny documents on paid tiers). The cron endpoint is auto-triggered so background processing begins right away.  
7. **Status monitoring:** watch the dashboard, activity logs, or `GET /api/health/pool` for progress (connection pool usage, throttling limits, Pinecone cleanup queue depth). Failed uploads remain in the list with error messages; retry after addressing the issue.

### Environment Configuration

Three environment templates are provided for different deployment scenarios:

#### Local Development Template (`.env.dev.template`)
- **Use case:** Local development with Docker Supabase (bypasses VPN authentication issues)
- **Supabase:** Local instance at `http://127.0.0.1:54321`
- **Setup:**
  ```bash
  cp .env.dev.template .env.local
  npx supabase start  # Copy credentials from output
  npm run dev
  ```
- **Features:**
  - `NODE_TLS_REJECT_UNAUTHORIZED=0` for corporate VPN environments
  - Conservative limits for local testing (2 concurrent operations, 40 pool connections)
  - All other services (Google Cloud, Pinecone, Draftable) use managed instances

#### Free Tier Template (`.env.free.template`)
- **Use case:** Production deployment with free-tier managed services
- **Supabase:** Managed cloud instance
- **Configuration:**
  - Conservative connection pool (2-40 connections)
  - Limited concurrency (2 concurrent uploads/deletes)
  - Single document processing (`MAX_CONCURRENT_DOCUMENTS=1`)
  - Suitable for Supabase and Pinecone free plans

#### Paid Tier Template (`.env.paid.template`)
- **Use case:** Production deployment with paid-tier services for higher performance
- **Supabase:** Managed cloud instance
- **Configuration:**
  - Larger connection pool (20-200 connections)
  - Higher concurrency (5 concurrent operations)
  - Parallel document processing (`MAX_CONCURRENT_DOCUMENTS=10`)
  - Enhanced similarity workers (`SIMILARITY_STAGE2_WORKERS=8`)
  - Adjust limits further based on your service quotas

All templates include comprehensive inline documentation and consistent structure for easy maintenance.

## Operational Guardrails

- **Request throttling:** Uploads and deletes are limited by `UPLOAD_*` and `DELETE_*` environment variables. Free-tier defaults allow two concurrent operations globally and per user; paid tiers start at five.
- **Document AI queue:** Free-tier deployments process one document at a time (`MAX_CONCURRENT_DOCUMENTS=1`) so long PDFs stay within Supabase connection limits.
- **Pinecone cleanup worker:** Document deletions enqueue background vector cleanup with exponential backoff. Tune `PINECONE_DELETE_MAX_RETRIES` and `PINECONE_DELETE_BACKOFF_MS` as needed.
- **Health monitoring:** `GET /api/health/pool` reports Supabase pool metrics, throttling state, and Pinecone cleanup queue depth so you can keep an eye on resource pressure.
- **Similarity worker cap:** `SIMILARITY_STAGE2_WORKERS` controls how many Stage 2 scoring jobs can run in parallel (defaults to 1 for free tier); raise it alongside Supabase pool limits on higher plans.
- **Directional reuse metrics:** Stage 2 reports `sourceScore` / `targetScore` as the percentage of each document whose content appears in the other (based on character counts for accurate measurement).
- **Length ratio:** The similarity cards also display `Length Ratio`, which is the source document's character count divided by the target document's character count (e.g., `0.50` means the source is half the size of the target). This helps flag size mismatches even when reuse percentages are high.

### Similarity Search Pipeline

The production similarity endpoint (`/api/documents/[id]/similar-v2`) and the Selected Search flow share the same three-stage pipeline:

1. **Stage 0 – Centroid retrieval**  
   - Uses the document centroid to gather up to `stage0_topK` (default 600) candidate documents from Pinecone.  
   - Filters always include `user_id`; optional metadata filters and page ranges are applied here.

2. **Stage 1 – Chunk-level prefilter (optional)**  
   - Runs only when the Stage 0 candidate set exceeds `stage1_topK` (default 250).  
   - For each source chunk, performs a fast ANN search across candidate chunks to narrow the list.  
   - Skipped automatically when the candidate pool is already small.

3. **Stage 2 – Adaptive scoring with sections**
   - Fetches the full chunk sets for each candidate, respecting manual exclusions such as subscription agreement skip ranges.
   - Performs bidirectional matching with non-max suppression and minimum evidence thresholds.
   - Computes character-based scores using `computeAdaptiveScore`, returning:
     - `sourceScore`: fraction of source characters matched.
     - `targetScore`: fraction of target characters matched.
     - `matchedSourceCharacters` / `matchedTargetCharacters`.
     - `lengthRatio`: source characters ÷ target characters.
   - Groups matches into sections (page ranges) for easier inspection.

Results are sorted by `sourceScore`, then `targetScore`, then matched target characters, followed by upload date and title. General Search returns the default Top 30; Selected Search filters the candidate list to the user-chosen targets and highlights the new Length Ratio metric.

### Running the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Available Scripts

- `npm run dev`: Runs the development server.
- `npm run build`: Builds the application for production.
- `npm run start`: Starts the production server.
- `npm run lint`: Lints the code.
- `npm run type-check`: Runs the TypeScript compiler to check for type errors.

## Project Structure

```
.
├── src
│   ├── app
│   │   ├── api
│   │   ├── auth
│   │   ├── dashboard
│   │   ├── documents
│   │   └── login
│   ├── components
│   ├── hooks
│   ├── lib
│   └── types
├── public
├── scripts
└── ...
```

## Deployment

### Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme).

Check out the [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.

### Docker

This project includes a `Dockerfile` and `docker-compose.yml` for building and running the application in a Docker container.

```bash
docker-compose up -d --build
```
