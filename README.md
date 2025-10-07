# PDF Searcher

A production-ready web application for processing PDF subscription documents with AI-powered similarity search. Built for internal company use with secure authentication and role-based access.

## Features

- **Secure Authentication**: User authentication with Supabase Auth
- **PDF Upload & Storage**: Upload up to 10 PDFs at once (max 50MB each)
- **AI Document Processing**: Extract text and structured fields using Google Document AI
- **Similarity Search**: Search similar documents using Google Vertex AI embeddings and Pinecone vector search
- **Advanced Filtering**: Filter search results by metadata, date range, and content type
- **Real-time Processing**: Track document processing progress in real-time
- **Responsive UI**: Modern, responsive interface built with Next.js and Tailwind CSS

## Tech Stack

- **Frontend & API**: Next.js 14 with TypeScript
- **Authentication & Database**: Supabase (PostgreSQL + Auth + Storage)
- **Document Processing**: Google Document AI
- **Vector Search**: Pinecone + Google Vertex AI embeddings
- **UI Components**: Tailwind CSS + Radix UI
- **Form Handling**: React Hook Form + Zod validation

## Prerequisites

Before setting up the application, ensure you have:

1. **Node.js** (v18 or higher)
2. **Supabase Project** with database and storage configured
3. **Google Cloud Project** with Document AI API enabled
4. **Pinecone Account** with a vector index created (768 dimensions for Vertex AI)
5. **Google Vertex AI** enabled (uses same credentials as Document AI)

## Environment Setup

1. Copy the environment template:
```bash
cp .env.local.example .env.local
```

2. Configure your environment variables in `.env.local`:

### Supabase Configuration
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

### Google Document AI Configuration
```env
GOOGLE_CLOUD_PROJECT_ID=your_google_cloud_project_id
GOOGLE_CLOUD_LOCATION=us
GOOGLE_CLOUD_PROCESSOR_ID=your_document_ai_processor_id
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account-key.json
```

### Pinecone Configuration
```env
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=pdf-documents
```

### Google Vertex AI Configuration (Free!)
```env
# Uses same credentials as Document AI - already configured above
# Free tier: 1,000 requests per month
```

## Database Setup

1. **Create Supabase Project**: Go to [Supabase](https://supabase.com) and create a new project.

2. **Run Optimized Database Schema**: Execute the production-ready SQL schema in your Supabase SQL editor:
```bash
# Copy and paste the contents of database-optimized-schema.sql
# This includes: core schema, page tracking, batch processing, and 62x performance optimizations
```

   **Note:** This single file replaces all previous migration and optimization scripts for a clean, fast setup.

3. **Configure Storage Bucket**: The schema will automatically create a `documents` storage bucket with proper RLS policies.

## Google Document AI Setup

1. **Enable Document AI API** in your Google Cloud Console
2. **Create a Processor**:
   - Go to Document AI in Google Cloud Console
   - Create a new processor (Form Parser or General Document OCR)
   - Note the processor ID for your environment variables
3. **Create Service Account**:
   - Create a service account with Document AI permissions
   - Download the JSON key file
   - Set the path in `GOOGLE_APPLICATION_CREDENTIALS`

## Pinecone Setup

1. **Create Pinecone Account**: Sign up at [Pinecone](https://pinecone.io)
2. **Create Index**:
   - Index name: `pdf-documents`
   - Dimensions: `768` (for Google Vertex AI embeddings)
   - Metric: `cosine`
   - Pod Type: `p1.x1` (starter tier)

## Installation & Development

1. **Install Dependencies**:
```bash
npm install
```

2. **Run Development Server**:
```bash
npm run dev
```

3. **Open Application**: Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

### 1. User Registration
- Navigate to `/signup` to create a new account
- Users are automatically assigned the 'user' role
- Admin role can be assigned manually in the database

### 2. Document Upload
- Upload PDF files through the dashboard
- Maximum 10 files at once, 50MB each
- Processing typically takes 30-60 seconds per document

### 3. Document Processing
- Documents are processed with Google Document AI
- Extracted text and structured fields are stored
- Embeddings are generated and indexed in Pinecone

### 4. Similarity Search
- Click "Search Similar Documents" on any completed document
- Use filters to refine search results:
  - Investor type
  - Document type
  - Date range
  - Tags
  - Minimum similarity score
- Results show matching content snippets with confidence scores

## API Endpoints

### Documents
- `GET /api/documents` - List user documents
- `POST /api/documents/upload` - Upload new document
- `GET /api/documents/[id]` - Get document details
- `DELETE /api/documents/[id]` - Delete document
- `GET /api/documents/[id]/status` - Check processing status
- `POST /api/documents/[id]/similar` - Search similar documents

## Deployment

### Vercel (Recommended)

1. **Deploy to Vercel**:
```bash
npx vercel --prod
```

2. **Configure Environment Variables** in Vercel dashboard

3. **Upload Google Cloud Service Account Key**:
   - Create `/tmp` directory in your project
   - Upload the service account JSON file
   - Update `GOOGLE_APPLICATION_CREDENTIALS` path

### Docker Deployment

1. **Create Dockerfile**:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

2. **Build and Run**:
```bash
docker build -t pdf-ai-assistant .
docker run -p 3000:3000 --env-file .env.local pdf-ai-assistant
```

## Performance Considerations

- **Document Processing**: Runs asynchronously to avoid timeouts
- **Embedding Generation**: Batched for efficiency
- **Vector Search**: Optimized with metadata filtering
- **Database**: Proper indexing on frequently queried fields
- **Storage**: CDN-backed file storage through Supabase

## Security Features

- **Row Level Security (RLS)**: All database tables have RLS enabled
- **File Access Control**: Storage buckets use user-based access policies
- **API Protection**: All endpoints require authentication
- **Input Validation**: Comprehensive validation using Zod schemas
- **Error Handling**: Secure error messages without data leakage

## Monitoring & Logging

- **Processing Status**: Real-time processing status tracking
- **Error Logging**: Comprehensive error logging for debugging
- **Performance Metrics**: Built-in Next.js analytics support
- **Database Monitoring**: Supabase built-in monitoring

## Troubleshooting

### Common Issues

1. **Upload Failures**:
   - Check file size limits (50MB max)
   - Verify Supabase storage bucket permissions
   - Ensure PDF file format

2. **Processing Errors**:
   - Verify Google Document AI credentials
   - Check processor configuration
   - Review error logs in processing_status table

3. **Search Issues**:
   - Verify Pinecone index configuration (768 dimensions)
   - Check Google Vertex AI permissions
   - Ensure embeddings were generated

### Debug Commands

```bash
# Check database connection
npm run dev
# Navigate to /api/documents to test API

# Verify environment variables
echo $NEXT_PUBLIC_SUPABASE_URL

# Test Google Document AI
# Use Google Cloud Console to test processor
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is proprietary software for internal company use.

## Support

For technical support or questions, please contact the development team or create an issue in the project repository.