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
    cp .env.local.template .env.local
    ```
4.  Fill in the required environment variables in `.env.local`.
5.  Set up the database by running the `MASTER-DATABASE-SETUP.sql` script in your Supabase SQL Editor.

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