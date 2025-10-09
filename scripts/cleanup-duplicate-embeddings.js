
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Load environment variables from .env.local
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

// Colors for output
const colors = {
  green: '\x1b[32m✅ ',
  red: '\x1b[31m❌ ',
  yellow: '\x1b[33m⚠️  ',
  blue: '\x1b[34mℹ️  ',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset);
}

async function cleanupDuplicateEmbeddings() {
  const args = process.argv.slice(2);
  const isDryRun = !args.includes('--delete');

  if (isDryRun) {
    log('Running in DRY RUN mode. No data will be deleted.', 'yellow');
    log('To delete duplicates, run the script with the --delete flag.', 'yellow');
  } else {
    log('Running in DELETE mode. Duplicates will be permanently removed.', 'red');
  }

  log('Starting cleanup of duplicate embeddings...', 'blue');

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    log('Supabase environment variables not found. Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are in your .env.local file.', 'red');
    return;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // 1. Fetch all embeddings with pagination
    log('Fetching all document embeddings...', 'blue');
    let allEmbeddings = [];
    let page = 0;
    const pageSize = 1000;
    while (true) {
      const { data: embeddings, error: fetchError } = await supabase
        .from('document_embeddings')
        .select('id, document_id, chunk_index, created_at')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (fetchError) {
        log(`Failed to fetch embeddings on page ${page}: ${fetchError.message}`, 'red');
        return;
      }

      if (embeddings) {
        allEmbeddings.push(...embeddings);
        log(`Fetched page ${page + 1} (${embeddings.length} embeddings)...`, 'blue');
      }

      if (!embeddings || embeddings.length < pageSize) {
        break;
      }
      page++;
    }

    log(`Found a total of ${allEmbeddings.length} embeddings.`, 'blue');

    // 2. Identify duplicates
    const uniqueEmbeddings = new Map();
    const duplicateIds = [];

    for (const embedding of allEmbeddings) {
      const key = `${embedding.document_id}:${embedding.chunk_index}`;
      if (uniqueEmbeddings.has(key)) {
        const existing = uniqueEmbeddings.get(key);
        if (new Date(embedding.created_at) > new Date(existing.created_at)) {
          duplicateIds.push(existing.id);
          uniqueEmbeddings.set(key, embedding);
        } else {
          duplicateIds.push(embedding.id);
        }
      } else {
        uniqueEmbeddings.set(key, embedding);
      }
    }

    log(`Found ${duplicateIds.length} duplicate embeddings.`, 'yellow');

    // 3. Delete duplicates or log them in dry run
    if (duplicateIds.length > 0) {
      if (isDryRun) {
        log('The following embedding IDs would be deleted:', 'yellow');
        console.log(duplicateIds);
      } else {
        log('Deleting duplicates in batches...', 'blue');
        const batchSize = 100;
        let deletedCount = 0;

        for (let i = 0; i < duplicateIds.length; i += batchSize) {
          const batch = duplicateIds.slice(i, i + batchSize);
          const { error: deleteError } = await supabase
            .from('document_embeddings')
            .delete()
            .in('id', batch);

          if (deleteError) {
            log(`Failed to delete a batch of duplicates: ${deleteError.message}`, 'red');
            return;
          }
          deletedCount += batch.length;
          log(`Deleted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} duplicates.`, 'blue');
        }
        log(`Successfully deleted ${deletedCount} duplicate embeddings.`, 'green');
      }
    } else {
      log('No duplicates found.', 'green');
    }

    log('Cleanup complete!', 'green');

  } catch (error) {
    log(`An unexpected error occurred: ${error.message}`, 'red');
  }
}

// Run the cleanup script
cleanupDuplicateEmbeddings();
