# PDF AI Assistant - Enterprise Document Similarity Search

A production-ready web application for processing PDF subscription documents with AI-powered similarity search. Built for enterprise use with secure authentication, intelligent chunking, and advanced vector search capabilities.

## 🚀 Key Features

### Document Processing
- **Secure Authentication**: User authentication with Supabase Auth and role-based access
- **Bulk PDF Upload**: Upload up to 10 PDFs at once (max 50MB each)
- **AI Document Processing**: Extract text and structured fields using Google Document AI
- **Auto-Processor Detection**: Automatically selects optimal OCR or Form Parser based on document type
- **Batch Processing Support**: Handles large documents (100+ pages) via Google Cloud Batch API
- **Real-time Progress Tracking**: Monitor document processing status with live updates
- **Cancellation Support**: Cancel processing at any stage with automatic cleanup

### Intelligent Chunking (v4.5.0)
- **Paragraph-Based Chunking**: Uses Document AI paragraph boundaries (not regex)
- **Greedy Algorithm**: Optimal packing with 100-500 tokens per chunk, configurable overlap
- **Section Prefix Stripping**: Automatically removes 22+ section numbering patterns:
  - `1.`, `2.`, `A.`, `B.` - Simple numbers and letters
  - `2.1`, `3.1`, `1.a.` - Hierarchical numbering
  - `(i)`, `(ii)`, `(A)`, `(B)`, `(a)` - Parenthesized markers
- **Smart Merging**: Combines form options (Yes/No/N/A) with questions
- **Safe Content Preservation**: Legitimate references (e.g., "Section 301(A)") remain untouched
- **Sentence-level Splitting**: Oversized paragraphs split at sentence boundaries
- **Adaptive Paragraph Count**: Dynamically adjusts 1-N paragraphs per chunk based on content

### Advanced Similarity Search
- **3-Stage Pipeline**: Document centroid filtering → Candidate retrieval → Chunk-level matching
- **Vector Search**: Powered by Pinecone with 768-dim Google Vertex AI embeddings
- **Advanced Filtering**: Filter by metadata, date range, content type, tags, and similarity score
- **Page-Aware Search**: Results include page numbers and context snippets
- **Confidence Scoring**: Adaptive scoring based on document characteristics

### Enterprise Features
- **Unlimited Processing Queue**: Concurrent document processing without limits
- **Smart Retry Logic**: Exponential backoff with circuit breakers for all external APIs
- **Error Recovery**: Automatic retry on transient failures (max 3 attempts)
- **Activity Logging**: Comprehensive audit trail for all user actions
- **Performance Optimizations**: 70-90% faster queries with advanced indexing

## 🛠 Tech Stack

- **Frontend & API**: Next.js 14 with TypeScript
- **Authentication & Database**: Supabase (PostgreSQL + Auth + Storage)
- **Document Processing**: Google Document AI (OCR + Form Parser)
- **Vector Embeddings**: Google Vertex AI (text-embedding-004, free tier: 1,000 req/month)
- **Vector Search**: Pinecone (768-dimension cosine similarity)
- **UI Components**: Tailwind CSS + Radix UI + shadcn/ui
- **Form Handling**: React Hook Form + Zod validation
- **Logging**: Winston + Pino structured logging

## 📋 Prerequisites

Before setting up the application, ensure you have:

1. **Node.js** (v18 or higher)
2. **Supabase Project** with database, storage, and auth configured
3. **Google Cloud Project** with:
   - Document AI API enabled
   - Vertex AI API enabled
   - Service account with appropriate permissions
4. **Pinecone Account** with vector index (768 dimensions, cosine metric)

## ⚙️ Environment Setup

### 1. Copy Environment Template

```bash
cp .env.local.template .env.local
```

### 2. Configure Environment Variables

#### Supabase Configuration
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

#### Google Document AI Configuration
```env
GOOGLE_CLOUD_PROJECT_ID=your-google-cloud-project-id
GOOGLE_CLOUD_LOCATION=us
GOOGLE_CLOUD_STORAGE_BUCKET=your-batch-processing-bucket

# Document AI Processors
GOOGLE_CLOUD_PROCESSOR_ID=your_primary_processor_id
GOOGLE_CLOUD_FORM_PARSER_ID=your_form_parser_processor_id
GOOGLE_CLOUD_OCR_PROCESSOR_ID=your_ocr_processor_id
GOOGLE_APPLICATION_CREDENTIALS=./credentials/google-service-account.json
DOCUMENT_AI_SYNC_PAGE_LIMIT=15  # Synchronous processing chunk size (15 pages is the OCR hard limit)
```

#### Pinecone Configuration
```env
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=pdf-ai-assistant
```

#### Chunking Configuration (v4.5.0)
```env
# Paragraph-based chunking with greedy algorithm
MAX_CHUNK_TOKENS=500            # Maximum tokens per chunk (strict limit)
MIN_CHUNK_TOKENS=100            # Minimum tokens (fallback only)
PARAGRAPHS_PER_CHUNK=3          # Target paragraphs per chunk (2-4)
PARAGRAPH_OVERLAP=1             # Paragraphs to overlap between chunks
```

#### Optional: Debug, Monitoring & Redis
```env
DUMP_DOCUMENT_AI=0              # Set to 1 to save raw Document AI responses for debugging
VERBOSE_LOGS=true               # Enable detailed logging
CRON_SECRET=your_cron_secret    # For Vercel cron job authentication

# Upstash Redis (Optional - for Vercel caching)
UPSTASH_REDIS_REST_URL=https://your-redis-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token_here

# Database Connection Pooling
DB_POOL_MIN_CONNECTIONS=2
DB_POOL_MAX_CONNECTIONS=20
DB_POOL_IDLE_TIMEOUT=30000
DB_POOL_CONNECTION_TIMEOUT=5000
```

## 🗄 Database Setup

### Run the Master Setup Script

Execute the consolidated database setup in your Supabase SQL Editor:

```bash
# Open Supabase Dashboard → SQL Editor
# Copy and paste the contents of MASTER-DATABASE-SETUP.sql
```

**What this includes:**
- ✅ Core database schema (documents, embeddings, jobs, etc.)
- ✅ Enterprise-scale performance optimizations (70-90% faster queries)
- ✅ Advanced indexing for 100+ concurrent users
- ✅ Activity logging and audit trails
- ✅ 3-stage similarity search with centroid-based filtering
- ✅ Batch processing support
- ✅ Row Level Security (RLS) policies
- ✅ Automatic storage bucket creation

**Note:** This single script is fully idempotent and safe to run multiple times.

## 🔧 Google Cloud Setup

### 1. Enable Required APIs

```bash
# Enable Document AI API
gcloud services enable documentai.googleapis.com

# Enable Vertex AI API
gcloud services enable aiplatform.googleapis.com
```

### 2. Create Document AI Processors

1. Go to [Document AI Console](https://console.cloud.google.com/ai/document-ai)
2. Create two processors:
   - **Form Parser** (for structured documents)
   - **OCR Processor** (for general documents)
3. Note both processor IDs for your environment variables

### 3. Create Service Account

```bash
# Create service account
gcloud iam service-accounts create pdf-ai-assistant \
  --display-name="PDF AI Assistant"

# Grant necessary permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:pdf-ai-assistant@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/documentai.apiUser"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:pdf-ai-assistant@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# Download credentials
gcloud iam service-accounts keys create credentials/google-service-account.json \
  --iam-account=pdf-ai-assistant@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### 4. Setup Batch Processing Bucket (Optional)

```bash
# Create GCS bucket for batch processing (for large documents)
gsutil mb -l us gs://your-batch-processing-bucket
```

## 📦 Pinecone Setup

1. **Create Pinecone Account**: Sign up at [Pinecone](https://pinecone.io)
2. **Create Index**:
   ```
   - Name: pdf-ai-assistant
   - Dimensions: 768 (Google Vertex AI text-embedding-004)
   - Metric: cosine
   - Pod Type: p1.x1 (starter tier)
   - Metadata fields: user_id, document_id, page_number, chunk_index
   ```

## 🚀 Installation & Development

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Development Server

```bash
npm run dev
```

### 3. Type Check & Lint

```bash
npm run type-check
npm run lint
npm run lint:fix        # Auto-fix linting issues
npm run lint:strict     # Strict mode with zero warnings
```

### 4. Open Application

Navigate to [http://localhost:3000](http://localhost:3000)

## 📖 Usage Guide

### 1. User Registration & Authentication
- Navigate to `/signup` to create a new account
- Users are automatically assigned the 'user' role
- Admin role can be assigned manually in the `users` table

### 2. Document Upload
- Upload PDF files through the dashboard
- **Bulk upload**: Up to 10 files at once
- **Size limit**: 50MB per file
- **Supported format**: PDF only

### 3. Document Processing Pipeline

The system processes documents through 7 stages:

1. **Upload** → File stored in Supabase Storage
2. **Job Queue** → Document queued for processing
3. **Document AI OCR** → Text extraction with Google Document AI
4. **Chunking** → Intelligent paragraph-based chunking (v4.5.0)
5. **Embeddings** → Generate 768-dim vectors with Vertex AI
6. **Indexing** → Store in Supabase + index in Pinecone
7. **Completion** → Document ready for search

**Processing Time:**
- Small docs (1-10 pages): ~30-60 seconds
- Medium docs (10-50 pages): ~2-5 minutes
- Large docs (50-100+ pages): ~10-30 minutes (batch processing)

### 4. Similarity Search

**To search for similar documents:**
1. Click "Search Similar Documents" on any completed document
2. Use advanced filters:
   - **Content filters**: Investor type, document type
   - **Temporal filters**: Date range
   - **Quality filters**: Minimum similarity score (0-100%)
   - **Metadata filters**: Tags, custom fields
3. Results show:
   - Matching documents with confidence scores
   - Relevant content snippets
   - Page numbers and context
   - Highlighted matching sections

### 5. Document Management

- **View Details**: Click on any document to see full details
- **Download**: Download original PDF
- **Cancel Processing**: Cancel in-progress documents
- **Retry Failed**: Retry failed documents
- **Delete**: Remove documents (auto-cleans embeddings and vectors)

## 🔌 API Endpoints

### Documents
```
GET    /api/documents                    - List user documents
POST   /api/documents/upload             - Upload new document(s)
GET    /api/documents/[id]               - Get document details
DELETE /api/documents/[id]               - Delete document
GET    /api/documents/[id]/processing-status - Check processing status
POST   /api/documents/[id]/retry         - Retry failed document
POST   /api/documents/[id]/cancel        - Cancel processing
POST   /api/documents/[id]/similar-v2    - Advanced similarity search
GET    /api/documents/[id]/download      - Download original PDF
```

### Job Processing
```
GET    /api/cron/process-jobs            - Process queued jobs (Vercel cron)
POST   /api/cron/process-jobs            - Manual job processing trigger
```

### Debug & Admin
```
GET    /api/debug/batch-status           - Check batch processing status
POST   /api/debug/retry-embeddings       - Retry embedding generation
GET    /api/health                       - Health check
GET    /api/health/pool                  - Database pool status
```

## 🚢 Deployment

### Vercel (Recommended)

1. **Install Vercel CLI**:
```bash
npm install -g vercel
```

2. **Deploy**:
```bash
vercel --prod
```

3. **Configure Environment Variables**:
   - Add all environment variables in Vercel dashboard
   - Upload `google-service-account.json` via Vercel Storage or set `GOOGLE_APPLICATION_CREDENTIALS` inline

4. **Setup Cron Jobs** (in `vercel.json`):
```json
{
  "crons": [
    {
      "path": "/api/cron/process-jobs",
      "schedule": "* * * * *"
    }
  ]
}
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

**Build and run**:
```bash
docker build -t pdf-ai-assistant .
docker run -p 3000:3000 --env-file .env.local pdf-ai-assistant
```

## 🔒 Security Features

- ✅ **Row Level Security (RLS)**: All database tables enforce user isolation
- ✅ **Secure Storage**: Supabase Storage with user-scoped access policies
- ✅ **API Authentication**: All endpoints require valid JWT tokens
- ✅ **Input Validation**: Comprehensive Zod schema validation
- ✅ **Rate Limiting**: Protection against abuse
- ✅ **Secure Credentials**: Service account keys stored securely
- ✅ **Activity Logging**: Audit trail for compliance

## ⚡ Performance Optimizations

### Database
- **Advanced Indexing**: 70-90% faster queries
- **Connection Pooling**: Enterprise-scale connection management
- **Materialized Views**: Pre-aggregated analytics
- **Centroid Caching**: 3-stage similarity search pipeline

### Processing
- **Concurrent Jobs**: Unlimited parallel processing
- **Smart Retry**: Exponential backoff with circuit breakers
- **Batch Processing**: Automatic fallback for large documents
- **Streaming**: Efficient handling of large files

### Search
- **Vector Search**: Optimized Pinecone queries with metadata filters
- **Centroid Filtering**: Stage 0 document-level filtering
- **Chunk Deduplication**: Prevent duplicate results

## 📊 Monitoring & Logging

### Built-in Monitoring
- **Processing Status**: Real-time updates via `processing_status` table
- **Job Queue**: Monitor pending/processing/completed jobs
- **Error Tracking**: Comprehensive error logs with stack traces
- **Performance Metrics**: Query timing and throughput

### Structured Logging
```typescript
// All logs follow structured format
{
  level: 'info',
  timestamp: '2025-01-15T10:30:00Z',
  component: 'document-processing',
  operation: 'chunking',
  documentId: 'uuid',
  metrics: { chunkCount: 45, tokenCount: 8234 }
}
```

## 🐛 Troubleshooting

### Common Issues

**1. Upload Failures**
- ✅ Check file size (max 50MB)
- ✅ Verify Supabase Storage bucket exists and has correct RLS policies
- ✅ Ensure PDF format (not scanned images without OCR)

**2. Processing Errors**
- ✅ Verify Google Cloud credentials are valid
- ✅ Check Document AI processor IDs match environment variables
- ✅ Review `processing_status` table for detailed error messages
- ✅ Check if Vertex AI API is enabled

**3. Embedding Generation Failures**
- ✅ Verify `GOOGLE_CLOUD_PROJECT_ID` is correct
- ✅ Ensure Vertex AI API is enabled
- ✅ Check service account has `aiplatform.user` role
- ✅ Review retry logs (system retries up to 3 times automatically)

**4. Search Issues**
- ✅ Verify Pinecone index dimensions are 768
- ✅ Check embeddings were successfully generated (query `document_embeddings` table)
- ✅ Ensure document has `centroid_embedding` calculated
- ✅ Verify Pinecone index is not empty

**5. Chunking Issues**
- ✅ Check `MAX_CHUNK_TOKENS` is set (default: 500)
- ✅ Verify `PARAGRAPHS_PER_CHUNK` configuration (default: 3)
- ✅ Enable debug mode: `DUMP_DOCUMENT_AI=1`
- ✅ Review raw Document AI output in `/document-ai-debug/` folder
- ✅ Check chunking constants in `src/lib/constants/chunking.ts`

### Debug Mode

Enable comprehensive debugging:
```env
DUMP_DOCUMENT_AI=1
VERBOSE_LOGS=true
```

This saves raw Document AI responses to `/document-ai-debug/` for analysis.


## 🏗 Project Structure

```
pdf-searcher-basic-chunking/
├── src/
│   ├── app/                    # Next.js app directory
│   │   ├── api/                # API routes
│   │   │   ├── documents/      # Document management endpoints
│   │   │   ├── cron/           # Scheduled job endpoints
│   │   │   ├── debug/          # Debug & monitoring endpoints
│   │   │   ├── health/         # Health check endpoints
│   │   │   └── search/         # Search endpoints
│   │   ├── auth/               # Auth pages & callback
│   │   ├── login/              # Login page
│   │   ├── dashboard/          # Dashboard page
│   │   └── documents/          # Document detail pages
│   ├── components/             # React components
│   │   ├── auth/               # Authentication components
│   │   ├── dashboard/          # Dashboard UI
│   │   ├── similarity/         # Similarity search components
│   │   └── ui/                 # Reusable UI components
│   ├── lib/                    # Core business logic
│   │   ├── chunking/           # Paragraph & sentence chunkers
│   │   ├── similarity/         # 3-stage similarity pipeline
│   │   │   ├── core/           # Core similarity algorithms
│   │   │   ├── stages/         # 3-stage pipeline implementation
│   │   │   └── utils/          # Vector operations & utilities
│   │   ├── supabase/           # Supabase client & pooling
│   │   ├── constants/          # Configuration constants
│   │   ├── errors/             # Error handling utilities
│   │   ├── utils/              # General utilities
│   │   ├── document-processing.ts  # Main processing orchestrator
│   │   ├── embeddings-vertex.ts    # Vertex AI integration
│   │   └── pinecone.ts         # Pinecone vector operations
│   ├── hooks/                  # React hooks
│   └── types/                  # TypeScript definitions
├── credentials/                # Google service account keys
└── MASTER-DATABASE-SETUP.sql  # Complete database schema
```

## 🔄 Chunking Algorithm (v4.5.0)

### Greedy Paragraph Packing

```typescript
// Simplified algorithm overview
while (paragraphs.length > 0) {
  const chunk = []
  let tokens = 0

  // Keep adding paragraphs while they fit
  while (tokens + next_paragraph_tokens <= MAX_TOKENS) {
    chunk.push(next_paragraph)
    tokens += next_paragraph_tokens
  }

  // Save chunk and continue
  chunks.push(chunk)
}
```

**Key Features:**
- Configurable overlap for better context preservation
- Flexible token limits (100-500 tokens per chunk)
- Adaptive paragraph count (1-N paragraphs per chunk)
- Semantic coherence maintained
- Section prefixes automatically stripped
- Intelligent noise filtering (removes standalone numbers, page markers, etc.)

## 📝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run linting and type checks
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## 📄 License

This project is proprietary software for internal company use.

## 🆘 Support

For technical support or questions:
- Create an issue in the project repository
- Contact the development team
- Review troubleshooting guide above

---

**Version**: 4.5.0 (Greedy Chunking Algorithm)
**Last Updated**: January 2025
**Status**: Production Ready ✅
