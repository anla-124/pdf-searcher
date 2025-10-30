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
3.  Set up your environment variables by copying the example file:
    ```bash
    # For Supabase/Pinecone free plans
    cp .env.free.template .env.local

    # For paid tiers
    # cp .env.paid.template .env.local
    ```
4.  Fill in the required environment variables in `.env.local`.
5.  Set up the database by running the `MASTER-DATABASE-SETUP.sql` script in your Supabase SQL Editor.

### Environment Profiles

Two environment templates ship with the project:

- `.env.free.template`: tuned for the Supabase and Pinecone free tiers with conservative connection-pool and throttling limits.
- `.env.paid.template`: starting point for paid tiers—raise the limits further once you confirm the service quotas.

Copy the template that matches your target environment to `.env.local`, then populate the credential placeholders.

## Operational Guardrails

- **Request throttling:** Uploads and deletes are limited by `UPLOAD_*` and `DELETE_*` environment variables. Free-tier defaults allow two concurrent operations globally and per user; paid tiers start at five.
- **Document AI queue:** Free-tier deployments process one document at a time (`MAX_CONCURRENT_DOCUMENTS=1`) so long PDFs stay within Supabase connection limits.
- **Pinecone cleanup worker:** Document deletions enqueue background vector cleanup with exponential backoff. Tune `PINECONE_DELETE_MAX_RETRIES` and `PINECONE_DELETE_BACKOFF_MS` as needed.
- **Health monitoring:** `GET /api/health/pool` reports Supabase pool metrics, throttling state, and Pinecone cleanup queue depth so you can keep an eye on resource pressure.
- **Similarity worker cap:** `SIMILARITY_STAGE2_WORKERS` controls how many Stage 2 scoring jobs can run in parallel (defaults to 1 for free tier); raise it alongside Supabase pool limits on higher plans.
- **Directional reuse metrics:** Stage 2 now reports `sourceScore` / `targetScore` as the percentage of each document whose content appears in the other (duplicate tokens in the target are counted, so reusable content is explicit).

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
